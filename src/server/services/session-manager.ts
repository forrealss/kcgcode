/**
 * Session_Manager — lifecycle Session & orkestrasi headless opencode.
 *
 * Menggantikan versi PTY/TUI:
 * - `createSession` memastikan server `opencode serve` untuk Project lalu
 *   membuat Session di server headless (`POST /session`) — bukan spawn PTY.
 * - Output bukan chunk terminal, melainkan `SessionMessage` terstruktur yang
 *   disimpan di `messages` dan diteruskan via hook `onMessage`.
 * - Prompt dikirim lewat `prompt_async` (204) dan turn ditutup oleh event
 *   `session.idle` Session akar; pesan assistant dirakit dari parts SSE.
 *   Sebelumnya balasan `POST /message` yang menggantung dipakai, sehingga turn
 *   panjang (sub-agent) gagal tersimpan saat koneksi HTTP-nya putus.
 * - Interactive_Prompt berasal dari event SSE terstruktur:
 *   `permission.asked` (-> confirmation) dan `question.asked` (-> menu) —
 *   `prompt-detector.ts` (regex atas teks TUI) dihapus. Varian `*.v2.asked`
 *   ikut ditangani (skema opencode mengekspos keduanya) dengan penamaan field
 *   berbeda: v2 memakai `action`/`resources`, v1 `permission`/`patterns`.
 * - Sub-agent (`task`) dijalankan opencode sebagai Session terpisah dengan
 *   `parentID`; `session.created` memetakan child tersebut ke Session lokal
 *   induk agar prompt izin & streaming-nya tidak terbuang.
 * - `resolvePrompt` menjawab lewat `POST /permission/{id}/reply` /
 *   `POST /question/{id}/reply|reject` — bukan menulis `y\n` ke PTY.
 *
 * Prinsip error tetap sama: fungsi publik mengembalikan
 * `{ ok: true, data } | { ok: false, error }`, dan Session berstatus
 * `running` hanya setelah berhasil dibuat di server headless.
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { SessionStore } from "../../db";
import type {
  AgentType,
  InteractivePrompt,
  MessagePart,
  PromptResponse,
  Session,
  SessionMessage,
  SessionModel,
  SessionStatus,
} from "../../types";
import type { Result, SimpleResult } from "../result";
import type { AttachmentManager } from "./attachments";
import type {
  ModelOption,
  OpenCodeClient,
  OpenCodeEvent,
  OpenCodeFileRef,
} from "./opencode-client";
import type { OpenCodeServerManager } from "./opencode-server";

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

export const MAX_FREE_TEXT_LENGTH = 10000;
export const SEND_TIMEOUT_MS = 180_000;
export const SHUTDOWN_BUDGET_MS = 5000;

/** v1 headless: hanya opencode (claude-code punya mekanisme headless sendiri). */
export const SUPPORTED_AGENT_TYPES: readonly AgentType[] = ["opencode"];

export interface CreateSessionRequest {
  agentType: AgentType;
  projectId: string;
  /** Model pilihan user; null/undefined = model default opencode. */
  model?: SessionModel | null;
}

export type CreateSessionResult = { ok: true; session: Session } | { ok: false; error: string };

export type { SimpleResult };

export interface SessionManagerOptions {
  store: SessionStore;
  servers: OpenCodeServerManager;
  /**
   * Penyimpanan lampiran gambar (upload dari perangkat). Bila tidak diisi,
   * fitur gambar dinonaktifkan — pesan dengan `images` ditolak.
   */
  attachments?: AttachmentManager;
  now?: () => number;
  shutdownBudgetMs?: number;
  sendTimeoutMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Hook pesan baru — disambungkan ke WebSocket_Gateway. */
  onMessage?: (message: SessionMessage) => void;
  /**
   * Hook part pesan yang sedang di-stream (SSE `message.part.updated`).
   * `messageId` = id pesan assistant di opencode yang sedang dibangun.
   */
  onMessagePart?: (sessionId: string, messageId: string, part: MessagePart) => void;
  /** Hook Interactive_Prompt baru — disambungkan ke WebSocket_Gateway. */
  onPrompt?: (prompt: InteractivePrompt) => void;
  /** Hook perubahan status Session — disambungkan ke WebSocket_Gateway. */
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
  /** Hook Session dihapus permanen — disambungkan ke WebSocket_Gateway. */
  onDeleted?: (sessionId: string) => void;
  /** Hook error asinkron (mis. balasan model gagal) — disambungkan ke gateway. */
  onError?: (sessionId: string, message: string) => void;
  /**
   * Hook perubahan status turn — `true` saat model mulai merespon (turn
   * streaming aktif), `false` saat turn selesai/dibatalkan. Disambungkan ke
   * gateway agar Client tahu kapan tombol stop (interrupt) perlu tampil.
   */
  onTurnChange?: (sessionId: string, active: boolean) => void;
}

export interface SessionManager {
  createSession(req: CreateSessionRequest): Promise<CreateSessionResult>;
  listSessions(): Session[];
  getSession(sessionId: string): Result<Session>;
  stopSession(sessionId: string): SimpleResult;
  /**
   * Hentikan balasan model yang sedang berlangsung (interrupt ala opencode):
   * turn remote di-abort, parts yang sudah ter-stream disimpan, tapi Session
   * TETAP `running` — user bisa langsung kirim pesan baru tanpa Start ulang.
   */
  interruptSession(sessionId: string): SimpleResult;
  /**
   * Hapus Session permanen: pastikan server headless opencode hidup (spawn
   * ulang bila perlu) lalu hapus session remote di sana (beserta riwayat
   * pesannya), kemudian baris Session di Session_Store.
   */
  deleteSession(sessionId: string): Promise<SimpleResult>;
  /**
   * Menghidupkan kembali Session yang `stopped`/`crashed` — memakai ocSessionId
   * lama bila masih dikenal server headless, memakai sesi remote baru bila
   * tidak, lalu status kembali `running`.
   */
  resumeSession(sessionId: string): Promise<SimpleResult>;
  /** Daftar model yang tersedia pada server headless milik Project. */
  listModels(projectId: string): Promise<Result<ModelOption[]>>;
  /** Cari file project untuk autocomplete `@file` di composer. */
  findFiles(projectId: string, query: string): Promise<Result<string[]>>;
  /** Ganti model pilihan Session (`null` = kembali ke default opencode). */
  setSessionModel(sessionId: string, model: SessionModel | null): SimpleResult;
  /**
   * Kirim input bebas. `files` = path relatif project (`@file`); `images` =
   * id lampiran di Attachment_Store (gambar upload dari perangkat).
   */
  sendFreeTextInput(
    sessionId: string,
    text: string,
    files?: string[],
    images?: string[],
  ): Promise<SimpleResult>;
  resolvePrompt(
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): Promise<SimpleResult>;
  reconcileOnStartup(): void;
  shutdown(): Promise<void>;
}

/** Ambil nilai field event dengan toleransi beberapa nama kunci. */
function field(ev: OpenCodeEvent, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = ev[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Deskripsi singkat sebuah permission request untuk judul kartu.
 *
 * Menerima penamaan v1 (`permission` + `patterns`) maupun v2
 * (`action` + `resources`) — lihat `EventPermissionAsked` vs
 * `EventPermissionV2Asked` pada skema opencode.
 */
function describePermission(ev: OpenCodeEvent): string {
  const permission = field(ev, "permission", "action", "name");
  const patterns = field(ev, "patterns", "resources");
  const parts: string[] = [];
  if (typeof permission === "string") parts.push(permission);
  if (Array.isArray(patterns)) {
    for (const p of patterns.slice(0, 3)) {
      if (typeof p === "string") parts.push(`\`${p}\``);
    }
  }
  return parts.length > 0 ? parts.join(" — ") : "Izin tool";
} /**
 * Baris pertama pesan error dari event `session.error` opencode (bentuk SSE
 * ternormalisasi: `error: { name, data: { message } }`). Sisa `data.message`
 * berupa stack trace — tidak berguna untuk UI.
 */
function sessionErrorMessage(ev: OpenCodeEvent): string {
  const err = field(ev, "error");
  if (typeof err !== "object" || err === null) return "";
  const e = err as { data?: { message?: unknown } };
  if (typeof e.data !== "object" || e.data === null) return "";
  const raw = e.data.message;
  if (typeof raw !== "string" || raw.trim() === "") return "";
  return raw.split("\n")[0]?.trim() ?? "";
}

/**
 * Deskripsi ramah event `session.error` opencode. Nama error (`error.name`)
 * dipetakan ke pesan Indonesia; pesan asli (baris pertama) disertakan bila
 * ada karena sering lebih informatif (mis. `TypeError: File URL host …`).
 */
function describeSessionError(ev: OpenCodeEvent): string {
  const err = field(ev, "error");
  const name =
    typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  const line = sessionErrorMessage(ev);
  // Petunjuk ramah per nama error; null = pesan asli lebih informatif
  // (mis. `UnknownError` yang membawa TypeError asli).
  const hint = (() => {
    switch (name) {
      case "ProviderAuthError":
        return "Autentikasi provider model gagal. Periksa login opencode (`opencode auth`).";
      case "APIError":
        return "Provider model mengembalikan error API. Coba lagi atau ganti model.";
      case "ContentFilterError":
        return "Balasan model diblokir oleh filter konten.";
      case "ContextOverflowError":
        return "Konteks percakapan melebihi batas model. Mulai Session baru atau compact.";
      case "MessageOutputLengthError":
        return "Output model melebihi batas panjang pesan.";
      case "MessageAbortedError":
        return "Pemrosesan prompt dibatalkan.";
      case "StructuredOutputError":
        return "Output terstruktur model gagal diparse.";
      default:
        return null;
    }
  })();
  if (hint === null) return line || "Terjadi kesalahan saat memproses prompt.";
  return line ? `${hint} — ${line}` : hint;
}

/** Terjemahkan kode error pengiriman prompt ke pesan yang bisa dibaca user. */
function friendlySendError(raw: string): string {
  const r = raw.trim();
  if (r === "TURN_TIMEOUT") {
    return "Model tidak membalas dalam batas waktu yang ditentukan. Coba kirim ulang pesan.";
  }
  const asyncMatch = r.match(/^OC_PROMPT_ASYNC_FAILED(?:\((\d+)\))?(?::\s*(.*))?$/);
  if (asyncMatch) {
    const status = asyncMatch[1];
    const detail = asyncMatch[2];
    if (status) return `Gagal mengirim prompt ke opencode (status ${status}). Coba lagi.`;
    if (detail)
      return `Gagal mengirim prompt ke opencode: ${detail.split("\n")[0]?.trim() ?? detail}`;
    return "Gagal mengirim prompt ke opencode. Coba lagi.";
  }
  const sendFail = r.match(/^SEND_FAILED:\s*(.*)$/);
  if (sendFail) {
    const detail = sendFail[1];
    return detail
      ? `Gagal mengirim prompt: ${detail.split("\n")[0]?.trim() ?? detail}`
      : "Gagal mengirim prompt: koneksi ke opencode bermasalah.";
  }
  return r.split("\n")[0] ?? r;
}

/** Bangun Interactive_Prompt dari event `permission.asked`. */
function promptFromPermission(
  ev: OpenCodeEvent,
  sessionId: string,
  now: number,
): InteractivePrompt {
  const requestId = String(field(ev, "requestID", "id") ?? randomUUID());
  return {
    id: requestId,
    sessionId,
    kind: "permission",
    type: "confirmation",
    title: describePermission(ev),
    options: null,
    status: "pending",
    createdAt: now,
    resolvedAt: null,
  };
}

/** Bangun Interactive_Prompt dari event `question.asked` (pertanyaan pertama). */
function promptFromQuestion(ev: OpenCodeEvent, sessionId: string, now: number): InteractivePrompt {
  const requestId = String(field(ev, "requestID", "id") ?? randomUUID());
  const questions = field(ev, "questions");
  const first =
    Array.isArray(questions) && questions.length > 0
      ? (questions[0] as { question?: unknown; options?: unknown })
      : null;
  const options =
    first && Array.isArray(first.options)
      ? first.options
          .map((o) => (typeof o === "object" && o !== null ? (o as { label?: unknown }).label : o))
          .filter((l): l is string => typeof l === "string")
      : [];
  return {
    id: requestId,
    sessionId,
    kind: "question",
    type: "menu",
    title: first && typeof first.question === "string" ? first.question : null,
    options: options.length > 0 ? options : null,
    status: "pending",
    createdAt: now,
    resolvedAt: null,
  };
}

/**
 * Membuat instance Session_Manager terikat pada `store` dan `servers`.
 * `servers` (OpenCode_Server), `now`, dan timer dapat diinjeksi untuk test.
 */
export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  const store = opts.store;
  const servers = opts.servers;
  const attachments = opts.attachments;
  const now = opts.now ?? Date.now;
  const shutdownBudgetMs = opts.shutdownBudgetMs ?? SHUTDOWN_BUDGET_MS;
  const sendTimeoutMs = opts.sendTimeoutMs ?? SEND_TIMEOUT_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const onMessage = opts.onMessage;
  const onPrompt = opts.onPrompt;
  const onStatusChange = opts.onStatusChange;
  const onDeleted = opts.onDeleted;
  const onError = opts.onError;
  const onTurnChange = opts.onTurnChange;

  /**
   * Pemetaan ocSessionId (opencode) -> id Session lokal.
   *
   * Selain Session yang dibuat lewat `POST /session`, map ini juga memuat
   * child session yang dibuat opencode sendiri saat model memanggil `task`
   * (sub-agent). Child session punya `sessionID` sendiri di SSE, sehingga tanpa
   * pemetaan ini event-nya (termasuk `permission.asked`) akan terbuang.
   */
  const ocToSession = new Map<string, string>();
  /** Kebalikan `ocToSession`: id Session lokal -> seluruh ocSessionId miliknya. */
  const sessionOcIds = new Map<string, Set<string>>();
  /** Project yang event SSE-nya sudah disubscribe (subscription aktif). */
  const activeSubscriptions = new Map<string, { active: boolean; unsubscribe: () => void }>();
  /** Serialisasi kirim pesan per Session agar turn tidak tumpang tindih. */
  const inflight = new Map<string, Promise<void>>();
  /** Project yang sudah diproses saat server-nya keluar (hindari duplikasi). */
  const exitNotified = new Set<string>();
  /** Turn balasan yang sedang di-stream (key: id Session lokal). */
  const streamingTurns = new Map<string, StreamingTurn>();
  const onMessagePart = opts.onMessagePart;

  function updateStatus(sessionId: string, status: SessionStatus, changedAt: number): void {
    const res = store.updateSessionStatus(sessionId, status, changedAt);
    if (res.ok) onStatusChange?.(sessionId, status);
  }

  function updatePromptResolved(promptId: string): void {
    store.updatePromptStatus(promptId, "resolved", now());
  }

  /**
   * Simpan seluruh pesan assistant yang sudah terakumulasi dari parts SSE
   * (satu pesan per messageId, sesuai urutan kemunculan). Dipakai baik oleh
   * finalisasi sukses (`session.idle`) maupun gagal — parts yang sudah
   * ter-stream tidak boleh hilang walau turn berakhir dengan error.
   */
  function persistTurnParts(sessionId: string, turn: StreamingTurn): void {
    const createdAt = now();
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
      store.insertMessage(message);
      onMessage?.(message);
    }
  }

  /**
   * Tutup turn: rakit pesan assistant dari parts hasil SSE, simpan, kirim ke
   * Client. Dipanggil saat `session.idle` Session akar (atau stop/exit).
   *
   * Sumber kebenaran adalah parts SSE, bukan balasan `POST /message` — pada
   * turn panjang (mis. sub-agent) koneksi POST bisa putus sebelum balasan
   * datang, sehingga pesan final tidak akan pernah tersimpan.
   */
  function finalizeTurn(sessionId: string): void {
    const turn = streamingTurns.get(sessionId);
    if (!turn || turn.finalized) return;
    turn.finalized = true;
    if (turn.timeout !== undefined) clearTimeoutFn(turn.timeout);
    streamingTurns.delete(sessionId);
    onTurnChange?.(sessionId, false);
    persistTurnParts(sessionId, turn);
  }

  /**
   * Tutup turn dalam kondisi gagal (prompt ditolak, `session.error`, atau
   * timeout): parts yang sudah ter-stream tetap disimpan, lalu pesan error
   * ber-role assistant (part `type: "error"`) ditulis ke history agar
   * kegagalan terlihat dan bertahan setelah reattach. `onError` tetap
   * dipanggil untuk banner instan di Client.
   */
  function failTurn(sessionId: string, message: string): void {
    const turn = streamingTurns.get(sessionId);
    if (!turn || turn.finalized) return;
    turn.finalized = true;
    if (turn.timeout !== undefined) clearTimeoutFn(turn.timeout);
    streamingTurns.delete(sessionId);
    onTurnChange?.(sessionId, false);
    persistTurnParts(sessionId, turn);
    const errMsg: SessionMessage = {
      id: `err_${randomUUID()}`,
      sessionId,
      role: "assistant",
      parts: [{ type: "error", text: message }],
      createdAt: now(),
    };
    if (store.insertMessage(errMsg).ok) onMessage?.(errMsg);
    onError?.(sessionId, message);
  }

  /** Catat pemetaan ocSessionId -> Session lokal (juga untuk cleanup). */
  function mapOcSession(ocSessionId: string, sessionId: string): void {
    ocToSession.set(ocSessionId, sessionId);
    let owned = sessionOcIds.get(sessionId);
    if (!owned) {
      owned = new Set<string>();
      sessionOcIds.set(sessionId, owned);
    }
    owned.add(ocSessionId);
  }

  /** Lepas seluruh ocSessionId (induk + child) milik satu Session lokal. */
  function unmapOcSessions(sessionId: string): void {
    const owned = sessionOcIds.get(sessionId);
    if (!owned) return;
    for (const ocId of owned) ocToSession.delete(ocId);
    sessionOcIds.delete(sessionId);
  }

  /**
   * Daftarkan child session (sub-agent `task`) ke Session lokal induknya.
   *
   * opencode membuat session baru untuk setiap sub-agent dengan `parentID`
   * menunjuk session pemanggil. Event-nya (`permission.asked`, `message.*`)
   * memakai `sessionID` child, jadi tanpa pemetaan ini prompt izin sub-agent
   * tidak akan pernah sampai ke Client dan turn menggantung sampai timeout.
   * Rantai bersarang ikut tertangani karena induk sudah lebih dulu terpetakan.
   */
  function registerChildSession(ev: OpenCodeEvent): void {
    const info = field(ev, "info");
    if (typeof info !== "object" || info === null) return;
    const { id, parentID } = info as { id?: unknown; parentID?: unknown };
    if (typeof id !== "string" || typeof parentID !== "string") return;
    if (ocToSession.has(id)) return; // sudah terpetakan (mis. session induk)
    const sessionId = ocToSession.get(parentID);
    if (!sessionId) return; // induk bukan Session milik bridge — abaikan
    mapOcSession(id, sessionId);
  }

  /**
   * Handler event SSE dari satu server (per Project).
   * Selain permission/question, kini memproses streaming:
   * - `session.created` dengan `parentID` -> petakan child sub-agent ke induk.
   * - `message.updated` role=assistant -> catat id pesan assistant (turn).
   * - `message.part.updated` -> forward part ke Client (via onMessagePart).
   */
  function handleEvent(_projectId: string, ev: OpenCodeEvent): void {
    if (ev.type === "session.created") {
      registerChildSession(ev);
      return;
    }
    if (ev.type === "session.idle") {
      const ocId = field(ev, "sessionID", "sessionId");
      if (typeof ocId !== "string") return;
      const sessionId = ocToSession.get(ocId);
      if (!sessionId) return;
      // Sub-agent idle lebih dulu dari induknya; hanya idle Session akar yang
      // menandai turn selesai, jika tidak turn terpotong di tengah.
      const cur = store.getSession(sessionId);
      if (!cur.ok || cur.data.ocSessionId !== ocId) return;
      finalizeTurn(sessionId);
      return;
    }
    if (ev.type === "session.error") {
      const ocId = field(ev, "sessionID", "sessionId");
      if (typeof ocId !== "string") return;
      const sessionId = ocToSession.get(ocId);
      if (!sessionId) return;
      const err = field(ev, "error");
      const errName =
        typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
      // MessageAbortedError = turn dibatalkan (interrupt user / reject prompt).
      // Bukan kegagalan: parts yang sudah ter-stream disimpan tanpa banner error.
      const aborted = errName === "MessageAbortedError";
      const message = describeSessionError(ev);
      if (streamingTurns.has(sessionId)) {
        if (aborted) finalizeTurn(sessionId);
        else failTurn(sessionId, message);
      } else if (!aborted) {
        // Tanpa turn aktif, abort berarti turn sudah ditutup interrupt/stop -
        // jangan tampilkan banner "Pemrosesan prompt dibatalkan" ke Client.
        onError?.(sessionId, message);
      }
      return;
    }
    if (ev.type === "message.updated") {
      const ocId = field(ev, "sessionID", "sessionId");
      if (typeof ocId !== "string") return;
      const sessionId = ocToSession.get(ocId);
      if (!sessionId) return;
      const turn = streamingTurns.get(sessionId);
      if (!turn) return;
      const info = field(ev, "info");
      if (info && typeof info === "object") {
        const role = (info as { role?: unknown }).role;
        const id = (info as { id?: unknown }).id;
        if (role === "assistant" && typeof id === "string") {
          turn.assistantMsgIds.add(id);
        }
      }
      return;
    }
    if (ev.type === "message.part.updated") {
      const ocId = field(ev, "sessionID", "sessionId");
      if (typeof ocId !== "string") return;
      const sessionId = ocToSession.get(ocId);
      if (!sessionId) return;
      const turn = streamingTurns.get(sessionId);
      if (!turn || turn.assistantMsgIds.size === 0) return;
      const part = field(ev, "part");
      if (typeof part !== "object" || part === null) return;
      const p = part as MessagePart & { messageID?: unknown };
      const messageId = p.messageID;
      if (typeof messageId !== "string" || !turn.assistantMsgIds.has(messageId)) return;
      if (typeof p.type !== "string" || typeof p.id !== "string") return;
      let byPart = turn.parts.get(messageId);
      if (!byPart) {
        byPart = new Map<string, MessagePart>();
        turn.parts.set(messageId, byPart);
        turn.order.push(messageId);
      }
      byPart.set(p.id, p);
      onMessagePart?.(sessionId, messageId, p);
      return;
    }
    // v1 & v2 memakai id request yang sama (`per_...`), dan `prompts.id` adalah
    // PRIMARY KEY — jadi bila server memancarkan keduanya, insert kedua gagal
    // dan kartu tidak terduplikasi.
    if (ev.type === "permission.asked" || ev.type === "permission.v2.asked") {
      const ocId = field(ev, "sessionID", "sessionId");
      if (typeof ocId !== "string") return;
      const sessionId = ocToSession.get(ocId);
      if (!sessionId) return;
      const prompt = promptFromPermission(ev, sessionId, now());
      if (!store.insertPrompt(prompt).ok) return; // duplikat -> abaikan
      onPrompt?.(prompt);
      return;
    }
    if (ev.type === "question.asked" || ev.type === "question.v2.asked") {
      const ocId = field(ev, "sessionID", "sessionId");
      if (typeof ocId !== "string") return;
      const sessionId = ocToSession.get(ocId);
      if (!sessionId) return;
      const prompt = promptFromQuestion(ev, sessionId, now());
      if (!store.insertPrompt(prompt).ok) return;
      onPrompt?.(prompt);
    }
  }

  /** Pastikan server Project hidup; subscribe event SSE bila belum aktif. */
  async function ensureServerFor(
    projectId: string,
    projectPath: string,
  ): Promise<Result<{ client: OpenCodeClient }>> {
    const res = await servers.ensureServer(projectId, projectPath);
    if (!res.ok) return { ok: false, error: res.error };
    const handle = res.data;
    // Server headless dapat diganti (crash lalu ensure ulang, atau resume):
    // subscribe ulang SSE bila instance aktif belum punya subscription aktif.
    if (!activeSubscriptions.get(projectId)?.active) {
      const prev = activeSubscriptions.get(projectId);
      prev?.unsubscribe();
      const unsubscribe = handle.client.subscribeEvents((ev) => handleEvent(projectId, ev));
      activeSubscriptions.set(projectId, { active: true, unsubscribe });
    }
    // Server baru (atau hasil restart) — izinkan event exit berikutnya diproses.
    exitNotified.delete(projectId);
    return { ok: true, data: { client: handle.client } };
  }

  function enqueue(sessionId: string, task: () => Promise<void>): void {
    const prev = inflight.get(sessionId) ?? Promise.resolve();
    const next = prev.then(task).finally(() => {
      if (inflight.get(sessionId) === next) inflight.delete(sessionId);
    });
    inflight.set(sessionId, next);
  }

  async function createSession(req: CreateSessionRequest): Promise<CreateSessionResult> {
    // (1) tipe CLI_Agent didukung (Requirement 1.3)
    if (!SUPPORTED_AGENT_TYPES.includes(req.agentType)) {
      return { ok: false, error: "UNSUPPORTED_AGENT_TYPE" };
    }
    // (2) Project ada di Session_Store (Requirement 10.10)
    const projectRes = store.getProjectById(req.projectId);
    if (!projectRes.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const project = projectRes.data;
    // (3) direktori kerja Project masih ada di filesystem (Requirement 10.11)
    let dirExists = false;
    try {
      dirExists = existsSync(project.path) && statSync(project.path).isDirectory();
    } catch {
      dirExists = false;
    }
    if (!dirExists) return { ok: false, error: "PROJECT_DIR_NOT_FOUND" };

    // (4) pastikan server headless untuk Project (spawn bila perlu)
    const serverRes = await ensureServerFor(project.id, project.path);
    if (!serverRes.ok) return { ok: false, error: serverRes.error };
    const client = serverRes.data.client;

    // (5) validasi model pilihan terhadap daftar provider server (Req: pilih
    //     model). `null` = pakai default opencode. Daftar provider gagal
    //     diambil -> ditolak agar Session tidak lahir dengan model mati.
    const model: SessionModel | null = req.model ?? null;
    if (model) {
      const models = await client.listModels();
      if (!models.ok) return { ok: false, error: models.error };
      const known = models.data.some(
        (m) => m.providerID === model.providerID && m.modelID === model.modelID,
      );
      if (!known) return { ok: false, error: "MODEL_NOT_FOUND" };
    }

    // (6) buat Session di server headless
    const created = await client.createSession({
      title: "KCG Bridge Session",
    });
    if (!created.ok) return { ok: false, error: created.error };

    const sessionId = randomUUID();
    const createdAt = now();
    const session: Session = {
      id: sessionId,
      projectId: project.id,
      agentType: req.agentType,
      cwd: project.path,
      status: "running",
      ocSessionId: created.data.id,
      model,
      createdAt,
      updatedAt: createdAt,
    };
    const ins = store.insertSession(session);
    if (!ins.ok) {
      // Abort session remote agar tidak jadi yatim bila persistensi gagal.
      void client.abortSession(created.data.id);
      return ins;
    }
    mapOcSession(created.data.id, sessionId);
    return { ok: true, session };
  }

  function listSessions(): Session[] {
    return store.listSessions();
  }

  function getSession(sessionId: string): Result<Session> {
    return store.getSession(sessionId);
  }

  function stopSession(sessionId: string): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status !== "running") return { ok: false, error: "SESSION_NOT_RUNNING" };
    // Abort turn berjalan (best-effort, tidak menunggu).
    if (cur.data.ocSessionId) {
      const handle = servers.getServer(cur.data.projectId);
      void handle?.client.abortSession(cur.data.ocSessionId);
    }
    // Simpan parts yang sudah terkumpul sebelum Session ditutup.
    finalizeTurn(sessionId);
    // Lepas induk + seluruh child sub-agent milik Session ini.
    unmapOcSessions(sessionId);
    updateStatus(sessionId, "stopped", now());
    return { ok: true };
  }

  /**
   * Hentikan balasan model yang sedang berlangsung (interrupt ala opencode):
   * - Turn remote di-abort (best-effort, tidak menunggu).
   * - Parts yang sudah ter-stream disimpan sebagai pesan assistant final.
   * - Session TETAP `running` dan pemetaan SSE dipertahankan — user bisa
   *   langsung mengirim pesan baru tanpa Start ulang.
   * Idempoten: tanpa turn aktif tidak ada yang berubah (tetap `ok`).
   */
  function interruptSession(sessionId: string): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    // Abort turn berjalan (best-effort, tidak menunggu).
    if (cur.data.status === "running" && cur.data.ocSessionId) {
      const handle = servers.getServer(cur.data.projectId);
      void handle?.client.abortSession(cur.data.ocSessionId);
    }
    // Tutup turn bila ada: parts tersimpan + broadcast turn tidak aktif.
    finalizeTurn(sessionId);
    return { ok: true };
  }

  /**
   * Menghidupkan kembali Session yang `stopped`/`crashed` dengan riwayat
   * percakapan utuh:
   *
   * 1. Server headless Project di-ensure (spawn ulang bila sudah mati) —
   *    storage session opencode bertahan di disk project, sehingga ocSessionId
   *    lama biasanya masih dikenal server baru.
   * 2. ocSessionId diverifikasi via `GET /session/{id}`. Bila masih ada,
   *    dipakai lagi (riwayat server opencode tetap nyambung). Bila tidak,
   *    dibuat sesi remote baru dan `oc_session_id` di DB diperbarui — pesan
   *    lama di Session_Store tidak tersentuh.
   * 3. Pemetaan SSE diaktifkan kembali lalu status -> `running`.
   */
  async function resumeSession(sessionId: string): Promise<SimpleResult> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status === "running") return { ok: false, error: "SESSION_ALREADY_RUNNING" };
    const project = store.getProjectById(cur.data.projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };

    // (1) Pastikan server headless Project hidup (spawn ulang bila perlu).
    const serverRes = await ensureServerFor(project.data.id, project.data.path);
    if (!serverRes.ok) return { ok: false, error: serverRes.error };

    // (2) Verifikasi ocSessionId lama; bila tidak dikenal -> sesi remote baru.
    let ocSessionId = cur.data.ocSessionId;
    if (ocSessionId) {
      const remote = await serverRes.data.client.getSession(ocSessionId);
      if (remote.ok) {
        mapOcSession(ocSessionId, sessionId);
      } else {
        ocSessionId = null;
      }
    }
    if (!ocSessionId) {
      const created = await serverRes.data.client.createSession({
        title: "KCG Bridge Session (resumed)",
      });
      if (!created.ok) return { ok: false, error: created.error };
      ocSessionId = created.data.id;
      mapOcSession(ocSessionId, sessionId);
      const upd = store.updateSessionOcId(sessionId, ocSessionId);
      if (!upd.ok) return { ok: false, error: upd.error };
    }

    // (3) Status kembali running.
    updateStatus(sessionId, "running", now());
    return { ok: true };
  }

  /**
   * Daftar model yang tersedia untuk Project — server headless Project
   * di-ensure lebih dulu (spawn bila perlu) karena provider/model dibaca dari
   * konfigurasi opencode pada direktori Project.
   */
  async function listModels(projectId: string): Promise<Result<ModelOption[]>> {
    const project = store.getProjectById(projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const serverRes = await ensureServerFor(project.data.id, project.data.path);
    if (!serverRes.ok) return { ok: false, error: serverRes.error };
    return serverRes.data.client.listModels();
  }

  /**
   * Cari file di Project untuk autocomplete `@file` — index pencarian
   * milik server headless opencode (sesuai perilaku `@` di opencode TUI).
   * `query` kosong juga valid (mengembalikan daftar awal).
   */
  async function findFiles(projectId: string, query: string): Promise<Result<string[]>> {
    const project = store.getProjectById(projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const serverRes = await ensureServerFor(project.data.id, project.data.path);
    if (!serverRes.ok) return { ok: false, error: serverRes.error };
    return serverRes.data.client.findFiles(query);
  }

  /**
   * Ganti model pilihan Session. Berlaku untuk prompt berikutnya (prompt_async
   * selalu mengirim model tersimpan di Session), jadi tidak perlu restart.
   */
  function setSessionModel(sessionId: string, model: SessionModel | null): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const upd = store.updateSessionModel(sessionId, model);
    return upd.ok ? { ok: true } : { ok: false, error: upd.error };
  }

  /**
   * Hapus Session permanen:
   *
   * 1. Turn yang sedang stream difinalisasi & pemetaan SSE dilepas.
   * 2. Pastikan server headless Project hidup — spawn ulang bila mati — lalu
   *    `DELETE /session/{id}`: data session (termasuk seluruh pesan) ikut
   *    dihapus di sisi opencode. Penghapusan remote bersifat wajib: bila
   *    server tidak bisa di-spawn ulang atau menolak hapus, error diteruskan
   *    dan data lokal TIDAK dihapus — supaya tidak ada session opencode yang
   *    jadi yatim tanpa sepengetahuan user (bisa dicoba lagi kemudian).
   * 3. Baris Session + seluruh baris anaknya dihapus dari Session_Store.
   */
  async function deleteSession(sessionId: string): Promise<SimpleResult> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };

    finalizeTurn(sessionId);
    // Bila masih running, abort turn remote agar model berhenti dieksekusi.
    if (cur.data.status === "running" && cur.data.ocSessionId) {
      const runningHandle = servers.getServer(cur.data.projectId);
      void runningHandle?.client.abortSession(cur.data.ocSessionId);
    }
    unmapOcSessions(sessionId);

    // (2) Hapus di server headless — wajib: server di-spawn ulang bila mati
    //     agar data remote tidak tertinggal. Server hasil spawn dibiarkan
    //     hidup (bukan di-stop) karena mungkin sedang dipakai operasi lain
    //     dan hanya akan dihentikan saat shutdown.
    const ocSessionId = cur.data.ocSessionId;
    if (ocSessionId) {
      let client = servers.getServer(cur.data.projectId)?.client;
      if (!client) {
        const project = store.getProjectById(cur.data.projectId);
        if (!project.ok) return { ok: false, error: project.error };
        const serverRes = await ensureServerFor(project.data.id, project.data.path);
        if (!serverRes.ok) return { ok: false, error: serverRes.error };
        client = serverRes.data.client;
      }
      const remote = await client.deleteSession(ocSessionId);
      if (!remote.ok) return { ok: false, error: remote.error };
    }

    // (3) Hapus lokal (transaksional: messages, prompts, history, session).
    const res = store.deleteSession(sessionId);
    if (res.ok) {
      // Lampiran gambar milik Session ikut dibersihkan (best effort).
      attachments?.removeSession(sessionId);
      onDeleted?.(sessionId);
    }
    return res;
  }

  async function sendFreeTextInput(
    sessionId: string,
    text: string,
    files: string[] = [],
    images: string[] = [],
  ): Promise<SimpleResult> {
    // Pesan berupa teks bebas dan/atau gambar: teks kosong diizinkan bila ada
    // gambar terlampir (mis. kirim gambar saja), selainnya wajib non-kosong.
    const hasText = text.trim().length > 0;
    const hasImages = images.length > 0;
    if (!hasText && !hasImages) {
      return { ok: false, error: "TEXT_EMPTY" };
    }
    if (hasText && text.length > MAX_FREE_TEXT_LENGTH) {
      return { ok: false, error: "TEXT_TOO_LONG" };
    }
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status !== "running") return { ok: false, error: "SESSION_NOT_ACTIVE" };
    const ocSessionId = cur.data.ocSessionId;
    if (!ocSessionId) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    // Pastikan server masih hidup SEBELUM menyimpan echo user.
    const handle = servers.getServer(cur.data.projectId);
    if (!handle) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    // Gambar upload dipetakan ke info + path absolut. Kegagalan resolve
    // (id tidak dikenal / sudah dihapus) menolak pengiriman tanpa echo.
    const imageInfos: { id: string; filename: string; mime: string; absPath: string }[] = [];
    for (const id of images) {
      const info = attachments?.info(sessionId, id);
      if (!info?.ok) return { ok: false, error: "ATTACHMENT_NOT_FOUND" };
      imageInfos.push(info.data);
    }

    // Echo pesan user (disimpan + dikirim ke Client) sebelum menunggu balasan.
    // Referensi @file ikut di-echo sebagai part `file` mime text/plain;
    // gambar upload sebagai part `file` mime image/* dengan `attachmentId`
    // agar renderer dapat memuat bytes lewat HTTP. Path relatif project
    // diubah ke file URL absolut — opencode mem-parse `url` dengan URL()
    // sehingga `file://rel/path` (host=rel) ditolak di Linux; host kosong
    // (`file:///abs/path`) valid.
    const promptFiles: OpenCodeFileRef[] = [];
    const userParts: MessagePart[] = [{ type: "text", text }];
    for (const filename of files) {
      const url = `file://${path.resolve(cur.data.cwd, filename)}`;
      userParts.push({ type: "file", mime: "text/plain", filename, url });
      promptFiles.push({ filename, mime: "text/plain", url });
    }
    for (const info of imageInfos) {
      // Jaring pengaman: `file://` harus menunjuk path absolut (host kosong).
      // `file://rel/path` membuat host="rel" yang ditolak opencode.
      const url = `file://${path.resolve(info.absPath)}`;
      userParts.push({
        type: "file",
        mime: info.mime,
        filename: info.filename,
        url,
        attachmentId: info.id,
      });
      promptFiles.push({ filename: info.filename, mime: info.mime, url });
    }
    const userMessage: SessionMessage = {
      id: `usr_${randomUUID()}`,
      sessionId,
      role: "user",
      parts: userParts,
      createdAt: now(),
    };
    if (!store.insertMessage(userMessage).ok) return { ok: false, error: "MESSAGE_WRITE_FAILED" };
    onMessage?.(userMessage);

    // Turn sebelumnya yang belum idle ditutup dulu agar parts-nya tidak
    // tercampur ke turn baru dan tidak hilang.
    finalizeTurn(sessionId);

    // Mulai turn streaming: parts dari SSE `message.part.updated` di-forward.
    const turn: StreamingTurn = {
      assistantMsgIds: new Set(),
      parts: new Map(),
      order: [],
      finalized: false,
    };
    // Jaring pengaman bila `session.idle` tidak pernah datang (mis. server
    // mati di tengah turn) — parts yang sudah terkumpul tetap disimpan.
    turn.timeout = setTimeoutFn(() => {
      if (streamingTurns.get(sessionId) !== turn) return;
      failTurn(sessionId, friendlySendError("TURN_TIMEOUT"));
    }, sendTimeoutMs);
    streamingTurns.set(sessionId, turn);
    // Beri tahu Client bahwa model mulai merespon (tombol stop/interrupt aktif).
    onTurnChange?.(sessionId, true);

    enqueue(sessionId, async () => {
      try {
        // `prompt_async` balas 204 begitu prompt diterima; hasil turn tiba
        // lewat SSE dan ditutup oleh `session.idle`.
        const res = await handle.client.promptAsync(ocSessionId, text, cur.data.model, promptFiles);
        if (!res.ok) {
          failTurn(sessionId, friendlySendError(res.error ?? "OC_PROMPT_ASYNC_FAILED"));
        }
      } catch (e) {
        failTurn(sessionId, friendlySendError(`SEND_FAILED: ${(e as Error).message}`));
      }
    });

    return { ok: true };
  }

  async function resolvePrompt(
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): Promise<SimpleResult> {
    const p = store.getPrompt(promptId);
    if (!p.ok) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.sessionId !== sessionId) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.status !== "pending") return { ok: false, error: "PROMPT_ALREADY_RESOLVED" };

    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const handle = servers.getServer(cur.data.projectId);
    if (!handle) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    let res: SimpleResult;
    if (p.data.kind === "permission") {
      if (response === "approve") {
        res = await handle.client.replyPermission(promptId, "once");
      } else if (response === "deny" || response === "cancel") {
        // Cancel == tolak (tanpa meneruskan input), setara deny di mode TUI.
        res = await handle.client.replyPermission(promptId, "reject");
      } else {
        return { ok: false, error: "INVALID_PROMPT_RESPONSE" };
      }
    } else {
      // kind === "question" — opsi harus bagian dari daftar (Requirement 6.6)
      if (typeof response === "object" && response !== null) {
        if (!p.data.options?.includes(response.option)) {
          return { ok: false, error: "INVALID_PROMPT_OPTION" };
        }
        res = await handle.client.replyQuestion(promptId, [response.option]);
      } else if (response === "cancel") {
        res = await handle.client.rejectQuestion(promptId);
      } else {
        return { ok: false, error: "INVALID_PROMPT_RESPONSE" };
      }
    }
    if (!res.ok) return { ok: false, error: res.error };
    updatePromptResolved(promptId);
    return { ok: true };
  }

  /** Requirement 2.4: seluruh Session `running` tanpa server -> `crashed`. */
  function reconcileOnStartup(): void {
    for (const s of store.listSessions()) {
      if (s.status === "running") {
        updateStatus(s.id, "crashed", now());
      }
    }
  }

  /**
   * Requirement 2.3: simpan status terakhir Session `running` dalam budget
   * waktu, lalu hentikan seluruh server headless.
   */
  async function shutdown(): Promise<void> {
    const running = store.listSessions().filter((s) => s.status === "running");
    const results = running.map((s) => store.insertStatusHistory(s.id, "running", now()));
    await raceWithTimeout(Promise.resolve(results), shutdownBudgetMs);
    await servers.stopAll();
  }

  /** Balapan dengan timer budget; timer selalu dibersihkan setelah selesai. */
  async function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: unknown;
    const timeout: Promise<T> = new Promise((_resolve, reject) => {
      timer = setTimeoutFn(() => reject(new Error("shutdown budget exceeded")), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer !== undefined) clearTimeoutFn(timer);
    }
  }

  // Saat server keluar tak terduga, tandai Session project tsb `crashed`.
  servers.onServerExit((projectId) => {
    if (exitNotified.has(projectId)) return;
    exitNotified.add(projectId);
    const crashedAt = now();
    for (const s of store.listSessions()) {
      if (s.projectId === projectId && s.status === "running") {
        // Server mati di tengah turn: selamatkan parts yang sudah ter-stream.
        finalizeTurn(s.id);
        updateStatus(s.id, "crashed", crashedAt);
        unmapOcSessions(s.id);
      }
    }
  });

  return {
    createSession,
    listSessions,
    getSession,
    stopSession,
    interruptSession,
    resumeSession,
    deleteSession,
    listModels,
    setSessionModel,
    findFiles,
    sendFreeTextInput,
    resolvePrompt,
    reconcileOnStartup,
    shutdown,
  };
}
