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
 * bentuk part baru dari opencode.
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
  [k: string]: unknown;
}

/** Satu pesan percakapan terstruktur (user atau assistant). */
export interface SessionMessage {
  /** Id pesan (dari opencode `msg_...` atau id lokal untuk echo user). */
  id: string;
  /** Id Session lokal KCG Bridge. */
  sessionId: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  createdAt: number;
  /** Pesan sementara yang masih di-stream dari server headless (SSE). */
  streaming?: boolean;
}
