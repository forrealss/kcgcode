/**
 * Tipe domain bersama untuk KCG Bridge (headless mode).
 *
 * Perubahan dari versi PTY/TUI:
 * - `Session.ocSessionId` menyimpan id Session di server headless opencode
 *   (`ses_...`) sebagai pemetaan ke id Session lokal.
 * - Output_Stream chunk digantikan `SessionMessage` terstruktur (role + parts)
 *   yang berasal dari API headless — bukan byte terminal TUI.
 * - `InteractivePrompt` kini bersumber dari event terstruktur opencode
 *   (`permission.asked` / `question.asked`) lewat field `kind`, bukan hasil
 *   regex atas teks TUI (`prompt-detector.ts` dihapus).
 */
export type AgentType = "opencode" | "claude-code";

export type SessionStatus = "running" | "stopped" | "crashed";

export type PromptType = "confirmation" | "menu";

export type PromptStatus = "pending" | "resolved";

/** Sumber Interactive_Prompt: izin tool (permission) atau pertanyaan (question). */
export type PromptKind = "permission" | "question";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

/**
 * Model LLM pilihan untuk Session (dipakai saat mengirim prompt).
 * `null` = biarkan opencode memakai model default-nya.
 */
export interface SessionModel {
  providerID: string;
  modelID: string;
}

export interface Session {
  id: string;
  projectId: string;
  agentType: AgentType;
  cwd: string;
  status: SessionStatus;
  /** Id Session di server headless opencode (`ses_...`); null sebelum dibuat. */
  ocSessionId: string | null;
  /** Model LLM pilihan; null = model default opencode. */
  model: SessionModel | null;
  createdAt: number;
  updatedAt: number;
}

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

export interface InteractivePrompt {
  /** Id request opencode (`per_...` / `que_...`) — dipakai untuk reply. */
  id: string;
  sessionId: string;
  kind: PromptKind;
  type: PromptType;
  /** Teks pertanyaan (question) atau deskripsi izin (permission). */
  title: string | null;
  options: string[] | null;
  status: PromptStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export type PromptResponse = "approve" | "deny" | "cancel" | { option: string };

/** Hasil operasi tanpa payload (ok / gagal dengan kode error). */
export type SimpleResult = { ok: boolean; error?: string };

/** Satu entri riwayat status (append-only). */
export interface StatusHistoryEntry {
  sessionId: string;
  status: SessionStatus;
  changedAt: number;
}

/**
 * Tipe hasil diskriminasi yang dipakai seluruh layer domain:
 * `{ ok: true; data } | { ok: false; error }` — bukan `throw`,
 * sesuai `design.md` — Error Handling.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
