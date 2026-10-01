/**
 * Info Git ringkas untuk panel konteks Session (bagian "Environment").
 *
 * opencode sendiri hanya melaporkan `vcs: "git"` tanpa nama cabang, jadi
 * cabang & selisih commit dibaca langsung lewat `git` di worktree Session.
 *
 * Keputusan:
 * - `Bun.spawn` dengan argumen ARRAY (bukan string shell) — path project
 *   berasal dari konfigurasi pengguna dan tidak boleh diinterpretasi shell.
 * - Hanya perintah BACA (`rev-parse`, `rev-list`, `remote`); tidak pernah
 *   mengubah repo.
 * - Semua kegagalan -> `null`/nilai netral: direktori bukan repo git, `git`
 *   tidak terpasang, atau repo tanpa commit bukan kondisi error bagi UI.
 * - Timeout 3 detik per perintah supaya panel tidak menggantung pada repo
 *   yang lambat / filesystem jaringan.
 */

import type { GitState } from "../../types";

const TIMEOUT_MS = 3000;

export const EMPTY_GIT_INFO: GitState = {
  branch: null,
  ahead: null,
  behind: null,
  hasRemote: false,
};

/** Jalankan satu perintah git; stdout ter-trim, atau null bila gagal. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) return null;
    const text = out.trim();
    return text === "" ? null : text;
  } catch {
    // `git` tidak ada di PATH, cwd hilang, dll.
    return null;
  }
}

/** Pasangan "ahead behind" dari `rev-list --count --left-right`. */
function parseAheadBehind(raw: string | null): { ahead: number | null; behind: number | null } {
  if (raw === null) return { ahead: null, behind: null };
  const [a, b] = raw.split(/\s+/);
  const ahead = Number.parseInt(a ?? "", 10);
  const behind = Number.parseInt(b ?? "", 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

/**
 * Baca cabang + selisih commit di `cwd`. Bukan repo git / git tidak tersedia
 * -> `EMPTY_GIT_INFO` (panel menampilkannya sebagai "Not a git repository").
 */
export async function readGitInfo(cwd: string): Promise<GitState> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return EMPTY_GIT_INFO;

  const [branch, remotes] = await Promise.all([
    // `--abbrev-ref HEAD` -> "HEAD" saat detached; diperlakukan tanpa cabang.
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["remote"]),
  ]);

  // Selisih commit hanya berarti bila cabang punya upstream.
  const counts = await git(cwd, ["rev-list", "--count", "--left-right", "@{upstream}...HEAD"]);
  // Urutan `--left-right` untuk `upstream...HEAD` = behind (kiri), ahead (kanan).
  const { ahead: left, behind: right } = parseAheadBehind(counts);

  return {
    branch: branch === null || branch === "HEAD" ? null : branch,
    ahead: right,
    behind: left,
    hasRemote: remotes !== null,
  };
}
