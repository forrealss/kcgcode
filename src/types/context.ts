/**
 * Konteks kerja Session untuk panel kanan ("Environment / Task list /
 * Reference"). Dipakai server (`sessionContext`) maupun UI, jadi bentuknya
 * hanya didefinisikan di sini.
 *
 * Sumber datanya tiga hal yang berbeda:
 * - `changes` + `git` : keadaan worktree project (opencode `GET /file/status`
 *   dan perintah `git` baca di cwd Session).
 * - `todos`           : task list agent (`todowrite`, `GET /session/{id}/todo`).
 * - `mcp`             : MCP server Project & status koneksinya (`GET /mcp`).
 * - Reference (file yang dibuka tool) TIDAK ada di sini: itu diturunkan di
 *   klien dari parts pesan yang sudah dimiliki timeline (`lib/references.ts`),
 *   sehingga tidak perlu request tambahan.
 */

/** Satu file yang berubah di worktree. */
export interface FileChange {
  path: string;
  added: number;
  removed: number;
  status: "added" | "deleted" | "modified";
}

/** Satu item task list agent. */
export interface TodoItem {
  content: string;
  /** `pending` | `in_progress` | `completed` | `cancelled` (string bebas). */
  status: string;
  /** `high` | `medium` | `low` (string bebas). */
  priority: string;
}

/** Keadaan Git worktree Session. */
export interface GitState {
  /** Cabang aktif; null = detached HEAD / bukan repo git / belum ada commit. */
  branch: string | null;
  /** Commit lokal yang belum dipush; null = cabang tanpa upstream. */
  ahead: number | null;
  /** Commit upstream yang belum ditarik; null = cabang tanpa upstream. */
  behind: number | null;
  hasRemote: boolean;
}

/** Satu MCP server Project (subset status opencode `GET /mcp`). */
export interface McpServerState {
  name: string;
  status:
    | "connected"
    | "disabled"
    | "failed"
    | "needs_auth"
    | "needs_client_registration"
    | "unknown";
  /** Pesan error bila `status === "failed"`. */
  error: string | null;
}

export interface SessionContext {
  git: GitState;
  changes: FileChange[];
  todos: TodoItem[];
  /** MCP server Project beserta status koneksinya. */
  mcp: McpServerState[];
  /**
   * Server opencode Session sedang hidup. `false` -> `todos`/`changes` kosong
   * karena belum bisa dibaca, BUKAN karena memang tidak ada.
   */
  live: boolean;
}
