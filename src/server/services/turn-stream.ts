/**
 * TurnStream — state turn balasan model yang sedang di-stream (per Session).
 *
 * Dipisah dari `session-manager.ts`:
 * - Satu turn = pesan assistant yang dirakit dari parts SSE
 *   (`message.part.updated`) yang diterima setelah `message.updated`
 *   role=assistant, disimpan per messageId sesuai urutan kemunculan.
 * - `finish` (sukses `session.idle` / stop / server keluar) menyimpan parts;
 *   `discard` (interrupt user) membuang parts; `fail` menyimpan parts lalu
 *   menulis pesan error role=assistant + `onError`.
 * - Timer batas waktu turn (jaring pengaman bila `session.idle` tak kunjung
 *   datang) dikelola di sini dan dibersihkan saat turn ditutup.
 */
import { randomUUID } from "node:crypto";
import type { SessionStore } from "../../db";
import type { MessagePart, SessionMessage } from "../../types";

/** Satu turn balasan yang sedang di-stream (SSE `message.part.updated`). */
interface StreamingTurn {
  /**
   * Id pesan assistant di opencode (`msg_...`) yang sedang dibangun.
   * Satu turn bisa memuat beberapa pesan assistant (mis. sub-agent/tool
   * yang memancarkan `msg_...` sendiri), jadi disimpan sebagai Set.
   */
  assistantMsgIds: Set<string>;
  /** Parts terakumulasi per pesan (messageId -> partId -> part). */
  parts: Map<string, Map<string, MessagePart>>;
  /** Urutan kemunculan messageId agar penyimpanan mengikuti alur turn. */
  order: string[];
  /** Sudah difinalisasi (persist + onMessage) — cegah pemrosesan ganda. */
  finalized: boolean;
  /** Timer batas waktu turn; dibersihkan saat finalisasi. */
  timeout?: unknown;
}

export interface TurnStreamOptions {
  store: SessionStore;
  now: () => number;
  /** Pesan assistant final/sementara — diteruskan ke Client. */
  onMessage?: (message: SessionMessage) => void;
  /** Part yang sedang di-stream — diteruskan ke Client. */
  onMessagePart?: (sessionId: string, messageId: string, part: MessagePart) => void;
  /** Error asinkron turn (mis. timeout) — banner di Client. */
  onError?: (sessionId: string, message: string) => void;
  /** Perubahan status turn — Client tahu kapan tombol stop aktif. */
  onTurnChange?: (sessionId: string, active: boolean) => void;
  setTimeoutFn: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
}

function emptyTurn(): StreamingTurn {
  return {
    assistantMsgIds: new Set(),
    parts: new Map(),
    order: [],
    finalized: false,
  };
}

export class TurnStream {
  private readonly turns = new Map<string, StreamingTurn>();

  constructor(private readonly opts: TurnStreamOptions) {}

  /** Apakah ada turn streaming aktif untuk Session ini. */
  has(sessionId: string): boolean {
    return this.turns.has(sessionId);
  }

  /**
   * Mulai turn streaming: buat entry + pasang timer jaring pengaman. Bila
   * `session.idle` tidak pernah datang (mis. server mati di tengah turn),
   * timer memanggil `fail` dengan `timeoutMessage` — parts yang sudah
   * terkumpul tetap disimpan.
   */
  begin(sessionId: string, timeoutMs: number, timeoutMessage: string): void {
    const turn = emptyTurn();
    turn.timeout = this.opts.setTimeoutFn(() => {
      // Jaring pengaman: turn sudah diganti/ditutup -> jangan proses lagi.
      if (this.turns.get(sessionId) !== turn) return;
      this.fail(sessionId, timeoutMessage);
    }, timeoutMs);
    this.turns.set(sessionId, turn);
    // Beri tahu Client bahwa model mulai merespon (tombol stop/interrupt aktif).
    this.opts.onTurnChange?.(sessionId, true);
  }

  /** Catat id pesan assistant (`message.updated` role=assistant) pada turn aktif. */
  noteAssistantMessage(sessionId: string, messageId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    turn.assistantMsgIds.add(messageId);
  }

  /**
   * Terima satu part streaming dari pesan assistant yang dikenal: simpan ke
   * akumulasi turn (per messageId) lalu forward ke Client. Part yang datang
   * sebelum assistant dikenal / untuk messageId lain diabaikan.
   */
  acceptPart(sessionId: string, messageId: string, part: MessagePart): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.assistantMsgIds.size === 0) return;
    if (!turn.assistantMsgIds.has(messageId)) return;
    if (typeof part.type !== "string" || typeof part.id !== "string") return;
    let byPart = turn.parts.get(messageId);
    if (!byPart) {
      byPart = new Map<string, MessagePart>();
      turn.parts.set(messageId, byPart);
      turn.order.push(messageId);
    }
    byPart.set(part.id, part);
    this.opts.onMessagePart?.(sessionId, messageId, part);
  }

  /**
   * Simpan seluruh pesan assistant yang sudah terakumulasi dari parts SSE
   * (satu pesan per messageId, sesuai urutan kemunculan). Dipakai baik oleh
   * finalisasi sukses (`session.idle`) maupun gagal — parts yang sudah
   * ter-stream tidak boleh hilang walau turn berakhir dengan error.
   */
  private persistParts(sessionId: string, turn: StreamingTurn): void {
    const createdAt = this.opts.now();
    for (const messageId of turn.order) {
      const byPart = turn.parts.get(messageId);
      if (!byPart || byPart.size === 0) continue;
      const message: SessionMessage = {
        id: messageId,
        sessionId,
        role: "assistant",
        parts: [...byPart.values()],
        createdAt,
      };
      // Turn ulang atas messageId yang sama (UNIQUE) gagal disimpan — pesan
      // tetap diteruskan agar Client tidak kehilangan balasan.
      this.opts.store.insertMessage(message);
      this.opts.onMessage?.(message);
    }
  }

  /** Tandai turn tertutup: bersihkan timer + hapus entry + broadcast tidak aktif. */
  private close(sessionId: string, turn: StreamingTurn): void {
    turn.finalized = true;
    if (turn.timeout !== undefined) this.opts.clearTimeoutFn(turn.timeout);
    this.turns.delete(sessionId);
    this.opts.onTurnChange?.(sessionId, false);
  }

  /**
   * Tutup turn sukses: rakit pesan assistant dari parts hasil SSE, simpan,
   * kirim ke Client. Dipanggil saat `session.idle` Session akar (atau
   * stop/exit).
   *
   * Sumber kebenaran adalah parts SSE, bukan balasan `POST /message` — pada
   * turn panjang (mis. sub-agent) koneksi POST bisa putus sebelum balasan
   * datang, sehingga pesan final tidak akan pernah tersimpan.
   */
  finish(sessionId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.finalized) return;
    this.close(sessionId, turn);
    this.persistParts(sessionId, turn);
  }

  /**
   * Buang turn yang sedang di-stream TANPA menyimpan parts-nya. Dipakai saat
   * user meng-interrupt: balasan parsial yang belum selesai dibuang agar
   * tidak tersimpan & tidak muncul kembali di riwayat/Client. Broadcast turn
   * tidak aktif tetap dikirim agar tombol stop di UI mati.
   */
  discard(sessionId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.finalized) return;
    this.close(sessionId, turn);
  }

  /**
   * Tutup turn dalam kondisi gagal (prompt ditolak, `session.error`, atau
   * timeout): parts yang sudah ter-stream tetap disimpan, lalu pesan error
   * ber-role assistant (part `type: "error"`) ditulis ke history agar
   * kegagalan terlihat dan bertahan setelah reattach. `onError` tetap
   * dipanggil untuk banner instan di Client.
   */
  fail(sessionId: string, message: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.finalized) return;
    this.close(sessionId, turn);
    this.persistParts(sessionId, turn);
    const errMsg: SessionMessage = {
      id: `err_${randomUUID()}`,
      sessionId,
      role: "assistant",
      parts: [{ type: "error", text: message }],
      createdAt: this.opts.now(),
    };
    if (this.opts.store.insertMessage(errMsg).ok) this.opts.onMessage?.(errMsg);
    this.opts.onError?.(sessionId, message);
  }
}
