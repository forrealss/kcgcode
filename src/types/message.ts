/**
 * Tipe pesan percakapan terstruktur (headless mode).
 *
 * Output_Stream chunk PTY/TUI digantikan `SessionMessage` (role + parts)
 * yang berasal dari API headless opencode.
 */
/**
 * Satu part pesan opencode (subset skema `Part` OpenAPI): `text`, `reasoning`,
 * `tool`, `step-start`, `step-finish`, `file`, `agent`, `subtask`, dll.
 * Dibiarkan toleran (indeks dinamis) agar renderer frontend tahan terhadap
 * bentuk part baru dari opencode. Field `state` (tool call) dipakai renderer
 * untuk label target tool (mis. `state.input.filePath`).
 *
 * Field `file` (mime/filename/url/attachmentId) dipakai untuk part `file`:
 * echo `@file` teks maupun gambar yang di-upload. `attachmentId` adalah id
 * lampiran di Attachment_Store KCG (gambar), dipakai renderer untuk memuat
 * bytes lewat route HTTP `/api/uploads/...`.
 */
export interface MessagePart {
  type: string;
  id?: string;
  text?: string;
  tool?: string;
  /** MIME part `file` (mis. `text/plain` untuk @file, `image/png` untuk gambar). */
  mime?: string;
  /** Nama file part `file` (nama asli / path relatif project). */
  filename?: string;
  /** URL file part (`file:///abs/path` dibaca opencode, bukan browser). */
  url?: string;
  /** Id lampiran gambar di Attachment_Store (gambar upload dari perangkat). */
  attachmentId?: string;
  /**
   * State tool call dari opencode: `status` (pending/running/error/done),
   * `input` (argumen tool, mis. `filePath` untuk read/edit), dan `output`
   * (hasil). Dipakai renderer untuk menampilkan target tiap tool call.
   */
  state?: { input?: Record<string, unknown>; output?: unknown };
  /**
   * Timing asli dari opencode (ReasoningPart, TextPart, ToolState).
   * `start`/`end` adalah Unix ms. Hadir di part yang sudah selesai di-stream;
   * saat masih di-stream `end` bisa undefined.
   */
  time?: { start?: number; end?: number; created?: number };
  [k: string]: unknown;
}

/** Satu pesan percakapan terstruktur (user atau assistant). */
export interface SessionMessage {
  /** Id pesan (dari opencode `msg_...` atau id lokal untuk echo user). */
  id: string;
  /** Id Session lokal KCG Code. */
  sessionId: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  createdAt: number;
  /** Pesan sementara yang masih di-stream dari server headless (SSE). */
  streaming?: boolean;
}
