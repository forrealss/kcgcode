/**
 * Protokol pesan WebSocket bersama Client <-> Server (versi headless).
 *
 * Perubahan dari versi PTY/TUI:
 * - `history` kini membawa `messages` (SessionMessage terstruktur) dan
 *   `prompts` (pending) — bukan chunk Output_Stream.
 * - `output`/`resize` dihapus; digantikan `message`, `stop` (hentikan Session)
 *   dan `interrupt` (hentikan balasan model saja — Session tetap berjalan).
 * - `turn_active` memberi tahu Client kapan model sedang merespon (turn
 *   streaming aktif) sehingga tombol stop/interrupt bisa ditampilkan.
 */
import type {
  AgentNotification,
  ComposerDraft,
  DevServerStatus,
  InteractivePrompt,
  MessagePart,
  PreviewSnapshot,
  PromptResponse,
  SessionMessage,
  SessionStatus,
  TurnDiff,
} from "./types";

/** Pesan Client -> Server. */
export type ClientMessage =
  | { type: "attach"; sessionId: string }
  | {
      type: "input";
      sessionId: string;
      text: string;
      /** Path relatif project untuk referensi `@file` (dibaca sebagai teks). */
      files?: string[];
      /** Id lampiran gambar di Attachment_Store KCG (upload dari perangkat). */
      images?: string[];
    }
  | { type: "prompt_response"; sessionId: string; promptId: string; response: PromptResponse }
  | { type: "stop"; sessionId: string }
  /**
   * Hentikan balasan model yang sedang berlangsung (interrupt ala opencode):
   * turn di-abort tapi Session tetap `running` sehingga bisa langsung kirim
   * pesan baru. Beda dari `stop` yang menonaktifkan Session.
   */
  | { type: "interrupt"; sessionId: string }
  /**
   * Notifikasi `notify` sudah tampil di layar perangkat ini (tab terlihat):
   * server tidak perlu mengirim Web Push ke `endpoint` (subscription push
   * perangkat ini) untuk notifikasi `id` tersebut.
   */
  | { type: "notify_ack"; id: string; endpoint: string }
  /**
   * Draf composer Session berubah di klien ini (teks / lampiran / elemen).
   * `origin` = id klien acak — klien mengabaikan siaran balik miliknya.
   */
  | { type: "draft"; sessionId: string; draft: ComposerDraft; origin: string };

/** Pesan Server -> Client. */
export type ServerMessage =
  | {
      type: "history";
      sessionId: string;
      messages: SessionMessage[];
      prompts: InteractivePrompt[];
    }
  | { type: "message"; sessionId: string; message: SessionMessage }
  /** Part pesan yang sedang di-stream (SSE `message.part.updated`). */
  | { type: "message_part"; sessionId: string; messageId: string; part: MessagePart }
  /**
   * Potongan teks baru untuk satu part (SSE `message.part.delta`): tambahkan
   * `delta` ke `part[field]` (biasanya `text`). Token model tiba lewat sini.
   */
  | {
      type: "message_part_delta";
      sessionId: string;
      messageId: string;
      partId: string;
      field: string;
      delta: string;
    }
  | { type: "prompt"; sessionId: string; prompt: InteractivePrompt }
  | { type: "prompt_resolved"; sessionId: string; promptId: string }
  | { type: "session_status"; sessionId: string; status: SessionStatus }
  /** Judul Session baru hasil generate opencode — daftar Session ikut terbarui. */
  | { type: "session_title"; sessionId: string; title: string }
  /** Permission mode Session berubah (oleh user atau agent; null = default). */
  | { type: "session_permission_mode"; sessionId: string; mode: string | null }
  /** Agent mulai (`true`) / selesai (`false`) meringkas riwayat Session (compact). */
  | { type: "session_compaction"; sessionId: string; compacting: boolean }
  /** Status turn: `active: true` = model sedang merespon; `false` = berhenti. */
  | { type: "turn_active"; sessionId: string; active: boolean }
  /** Session dihapus permanen — subscriber harus meninggalkan halamannya. */
  | { type: "session_deleted"; sessionId: string }
  /**
   * Daftar Project/Session berubah (dibuat / dihapus) dari perangkat mana
   * pun — dikirim ke semua koneksi; sidebar & daftar memuat ulang datanya.
   */
  | { type: "data_changed" }
  /**
   * Agent butuh perhatian (izin/pertanyaan) atau turn selesai — dikirim ke
   * semua koneksi. Tab yang terlihat memutar suara + toast lalu membalas
   * `notify_ack`; perangkat yang tidak membalas menerima Web Push.
   */
  | { type: "notify"; notification: AgentNotification }
  /** Status dev server Preview sebuah Project berubah — dikirim ke semua koneksi. */
  | { type: "preview_status"; projectId: string; server: DevServerStatus | null }
  /** Snapshot preview baru setelah turn agent selesai — ke koneksi Session itu. */
  | { type: "preview_snapshot"; sessionId: string; snapshot: PreviewSnapshot }
  /** File yang diubah agent di turn yang baru selesai — ke koneksi Session itu. */
  | { type: "turn_diff"; sessionId: string; diff: TurnDiff }
  /**
   * Draf composer Session (app & overlay Preview tersinkron). Dikirim saat
   * berubah, dan sebagai snapshot saat attach (`origin: "server"`).
   */
  | { type: "draft"; sessionId: string; draft: ComposerDraft; origin: string }
  | { type: "error"; code: string; message: string };

/** Kode error umum pada pesan `error`. */
export const ErrorCodes = {
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PROMPT_NOT_FOUND: "PROMPT_NOT_FOUND",
  PROMPT_ALREADY_RESOLVED: "PROMPT_ALREADY_RESOLVED",
  /** Reply prompt gagal diproses server opencode (mis. reply 404/400). */
  PROMPT_FAILED: "PROMPT_FAILED",
  /** Agent tidak lagi menunggu jawaban; prompt ditutup & kartu dihapus. */
  PROMPT_EXPIRED: "PROMPT_EXPIRED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  SESSION_NOT_RUNNING: "SESSION_NOT_RUNNING",
  INVALID_TEXT: "INVALID_TEXT",
  ATTACHMENT_NOT_FOUND: "ATTACHMENT_NOT_FOUND",
} as const;
