/**
 * Perubahan file per turn agent (diff antara snapshot working tree di awal
 * dan akhir turn). Ditampilkan sebagai kartu "N files changed" di akhir
 * turn, plus viewer diff & file.
 */

export type TurnFileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface TurnFileChange {
  /** Path relatif folder Project (posisi baru untuk rename). */
  path: string;
  /** Path lama (rename). */
  oldPath?: string;
  status: TurnFileChangeStatus;
  /** null untuk file biner. */
  additions: number | null;
  deletions: number | null;
}

export interface TurnDiff {
  id: string;
  sessionId: string;
  /** Id pesan assistant pertama turn (= id grup turn di timeline). */
  messageId: string | null;
  files: TurnFileChange[];
  createdAt: number;
}

/** Isi file Project untuk viewer. */
export interface ProjectFileContent {
  path: string;
  size: number;
  /** "text" -> `content`; "image" -> ambil lewat `?raw=1`; "binary" -> tidak ditampilkan. */
  kind: "text" | "image" | "binary";
  content: string | null;
  /** Dipotong karena terlalu besar. */
  truncated: boolean;
}
