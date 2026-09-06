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
 * - `noteError` mencatat `session.error` non-abort TANPA menutup turn —
 *   error sering tidak terminal (mis. referensi `@file` gagal dibaca) dan
 *   jawaban tetap di-stream setelahnya; pesan error hanya ditulis ke history
 *   bila turn ditutup tanpa konten apa pun.
 * - Timer turn adalah batas KEDIAMAN (inactivity), bukan batas total: setiap
 *   tanda hidup (`keepAlive`, part baru, pesan assistant) me-reset-nya,
 *   sehingga turn panjang yang sehat (reasoning/tool/sub-agent/retry) tidak
 *   dipotong di tengah jalan.
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
  /**
   * Error turn yang DITUNDA (`noteError`). opencode memancarkan
   * `session.error` yang tidak terminal lalu turn BERLANJUT — menutup turn
   * di sini membuang jawaban yang menyusul. Banner tetap tampil seketika;
   * pesan error baru ditulis ke history saat turn ditutup BILA tidak ada
   * konten baru setelah error (error memang yang terakhir terjadi).
   */
  pendingError: { message: string; partsAtError: number } | null;
  /** Timer batas idle turn; di-reset (`keepAlive`) tiap ada tanda hidup. */
  timeout?: unknown;
  /** Konfigurasi timer idle: durasi sunyi maksimum & pesan saat dipicu. */
  idleTimeoutMs: number;
  timeoutMessage: string;
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
  /**
   * Dipanggil saat timer idle terpicu: `false` = tunda fire dan pasang ulang
   * timer — turn sedang menunggu sesuatu yang bukan sunyi (mis. keputusan
   * user pada kartu permission/question). Tanpa ini, user yang lama memutus
   * kartu kehilangan jawaban yang sebenarnya masih hidup.
   */
  shouldFireIdle?: (sessionId: string) => boolean;
  setTimeoutFn: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
}

function emptyTurn(): StreamingTurn {
  return {
    assistantMsgIds: new Set(),
    parts: new Map(),
    order: [],
    finalized: false,
    pendingError: null,
    idleTimeoutMs: 0,
    timeoutMessage: "",
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
   * Mulai turn streaming: buat entry + pasang timer idle (jaring pengaman).
   * Timer adalah batas KEDIAMAN, bukan batas total: setiap tanda hidup (part
   * baru, pesan assistant, status opencode) me-reset-nya lewat `keepAlive`,
   * sehingga turn panjang yang sehat tidak dipotong. Bila sunyi terus sampai
   * batas (mis. server mati di tengah turn), timer memanggil `fail` dengan
   * `timeoutMessage` — parts yang sudah terkumpul tetap disimpan.
   */
  begin(sessionId: string, timeoutMs: number, timeoutMessage: string): void {
    const turn = emptyTurn();
    turn.idleTimeoutMs = timeoutMs;
    turn.timeoutMessage = timeoutMessage;
    this.turns.set(sessionId, turn);
    this.armTimer(sessionId, turn);
    // Beri tahu Client bahwa model mulai merespon (tombol stop/interrupt aktif).
    this.opts.onTurnChange?.(sessionId, true);
  }

  /** Pasang ulang timer idle turn (timer lama dibersihkan lebih dulu). */
  private armTimer(sessionId: string, turn: StreamingTurn): void {
    if (turn.timeout !== undefined) this.opts.clearTimeoutFn(turn.timeout);
    // Callback memeriksa handle MASIH yang terpasang: bila timer sudah
    // di-reset (`keepAlive`) tapi timer lama sempat terpicu (race), jangan
    // gagalkan turn yang justru sedang hidup.
    let handle: unknown;
    handle = this.opts.setTimeoutFn(() => {
      if (this.turns.get(sessionId) !== turn || turn.timeout !== handle) return;
      // Turn menunggu input user (kartu permission pending, dsb.) -> bukan
      // sunyi: tunda fire dan pasang ulang timer.
      if (this.opts.shouldFireIdle?.(sessionId) === false) {
        this.armTimer(sessionId, turn);
        return;
      }
      this.fail(sessionId, turn.timeoutMessage);
    }, turn.idleTimeoutMs);
    turn.timeout = handle;
  }

  /**
   * Tanda hidup opencode di tengah turn (part baru, status busy/retry):
   * reset timer idle agar turn panjang yang sehat tidak dipicu timeout.
   */
  keepAlive(sessionId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.finalized) return;
    this.armTimer(sessionId, turn);
  }

  /**
   * Catat error `session.error` non-abort pada turn yang masih berjalan:
   * banner diteruskan ke Client SEKETIKA, tapi turn TIDAK ditutup — error
   * semacam ini sering tidak terminal (mis. `@file` gagal dibaca; turn
   * lanjut dan jawaban tetap di-stream). Saat turn ditutup, pesan error
   * hanya ditulis ke history bila TIDAK ada konten baru setelah error
   * (lihat `finish`) — kalau jawaban menyusul, transcript tetap bersih.
   */
  noteError(sessionId: string, message: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.finalized) return;
    turn.pendingError = { message, partsAtError: this.countParts(turn) };
    this.opts.onError?.(sessionId, message);
    this.armTimer(sessionId, turn);
  }

  /** Catat id pesan assistant (`message.updated` role=assistant) pada turn aktif. */
  noteAssistantMessage(sessionId: string, messageId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    turn.assistantMsgIds.add(messageId);
    // Pesan assistant baru = tanda hidup: reset timer idle turn.
    this.armTimer(sessionId, turn);
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
    // Part baru = tanda hidup: reset timer idle turn.
    this.armTimer(sessionId, turn);
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
    // Error yang ditunda hanya menjadi pesan bila TIDAK ada konten baru
    // setelah error (error memang yang terakhir terjadi — gagal terminal).
    // Bila jawaban menyusul setelah error (kasus `@file` gagal dibaca),
    // menulis error di atas jawaban asli hanya membuat error palsu.
    // Banner sudah dikirim saat `noteError` — di sini cukup tulis history.
    const pending = turn.pendingError;
    if (pending && this.countParts(turn) === pending.partsAtError) {
      this.writeErrorMessage(sessionId, pending.message, false);
    }
  }

  /** Total jumlah part yang sudah terakumulasi pada turn. */
  private countParts(turn: StreamingTurn): number {
    let total = 0;
    for (const byPart of turn.parts.values()) total += byPart.size;
    return total;
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
    this.writeErrorMessage(sessionId, message);
  }

  /**
   * Tulis pesan error role=assistant (part `type: "error"`) ke history agar
   * kegagalan terlihat dan bertahan setelah reattach, plus banner instan ke
   * Client — kecuali `banner=false` (banner sudah dikirim lebih dulu).
   */
  private writeErrorMessage(sessionId: string, message: string, banner = true): void {
    const errMsg: SessionMessage = {
      id: `err_${randomUUID()}`,
      sessionId,
      role: "assistant",
      parts: [{ type: "error", text: message }],
      createdAt: this.opts.now(),
    };
    if (this.opts.store.insertMessage(errMsg).ok) this.opts.onMessage?.(errMsg);
    if (banner) this.opts.onError?.(sessionId, message);
  }
}
