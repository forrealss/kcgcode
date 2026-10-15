/** Akses file Project: status git, daftar file, dan konten pesan user. */
import { fileURLToPath } from "node:url";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FileChange } from "../../../types";
import type { AgentPromptFile } from "../types";

/** Jalankan `git` (argumen array, tanpa shell); stdout mentah atau null. */
export async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      windowsHide: true,
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), 5000);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    return code === 0 ? out : null;
  } catch {
    return null;
  }
}

/** File yang berubah di worktree (`git status` + `git diff --numstat HEAD`). */
export async function gitFileStatus(cwd: string): Promise<FileChange[]> {
  const status = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === null) return [];
  const counts = new Map<string, { added: number; removed: number }>();
  const numstat = await runGit(cwd, ["diff", "--numstat", "-z", "HEAD"]);
  if (numstat !== null) {
    // Format -z: "added\tremoved\tpath\0" (rename: "a\tr\t\0old\0new\0").
    const tokens = numstat.split("\0");
    for (let i = 0; i < tokens.length; i++) {
      const [a, r, p] = (tokens[i] ?? "").split("\t");
      if (a === undefined || r === undefined) continue;
      let file = p ?? "";
      if (file === "") {
        i += 2;
        file = tokens[i] ?? "";
      }
      if (file === "") continue;
      counts.set(file, {
        added: Number.parseInt(a, 10) || 0,
        removed: Number.parseInt(r, 10) || 0,
      });
    }
  }
  const out: FileChange[] = [];
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    // Rename/copy: entri berikutnya adalah path asal — lewati.
    if (xy[0] === "R" || xy[0] === "C") i += 1;
    const kind: FileChange["status"] =
      xy === "??" || xy.includes("A") ? "added" : xy.includes("D") ? "deleted" : "modified";
    const c = counts.get(file) ?? { added: 0, removed: 0 };
    out.push({ path: file, added: c.added, removed: c.removed, status: kind });
  }
  return out;
}

/**
 * Daftar file Project (relatif): `git ls-files` (tracked + untracked yang
 * tidak di-ignore); bukan repo git -> scan direktori (maks 20.000 file).
 */
export async function listProjectFiles(cwd: string): Promise<string[]> {
  const out = await runGit(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (out !== null) return out.split("\0").filter((f) => f !== "");
  const files: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const f of glob.scan({ cwd, onlyFiles: true })) {
    const rel = f.replaceAll("\\", "/");
    if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
    files.push(rel);
    if (files.length >= 20_000) break;
  }
  return files;
}

/** Peringkat path untuk autocomplete `@file` (null = tidak cocok). */
function matchScore(file: string, q: string): number | null {
  if (q === "") return file.length;
  const lower = file.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base.startsWith(q)) return file.length;
  if (base.includes(q)) return 1000 + file.length;
  if (lower.includes(q)) return 2000 + file.length;
  return null;
}

/** 50 path terbaik untuk query autocomplete `@file`. */
export function rankFiles(files: string[], query: string, limit = 50): string[] {
  const needle = query.trim().toLowerCase();
  const scored: { file: string; score: number }[] = [];
  for (const file of files) {
    const score = matchScore(file, needle);
    if (score !== null) scored.push({ file, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.file);
}

/** Gambar & PDF dikirim inline ke model; mime lain dirujuk lewat path. */
const INLINE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Bangun konten pesan user: teks + gambar/PDF base64. Referensi `@file` dan
 * lampiran non-inline ditulis sebagai daftar path absolut agar Claude
 * membacanya sendiri dengan tool Read.
 */
export async function buildUserContent(
  text: string,
  files: AgentPromptFile[],
): Promise<SDKUserMessage["message"]["content"]> {
  const blocks: Exclude<SDKUserMessage["message"]["content"], string> = [];
  const referenced: string[] = [];
  for (const f of files) {
    let absPath: string;
    try {
      absPath = fileURLToPath(f.uri);
    } catch {
      continue;
    }
    if (INLINE_IMAGE_MIMES.has(f.mime) || f.mime === "application/pdf") {
      try {
        const data = Buffer.from(await Bun.file(absPath).arrayBuffer()).toString("base64");
        if (f.mime === "application/pdf") {
          blocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data },
          });
        } else {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: f.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data,
            },
          });
        }
        continue;
      } catch {
        // Gagal dibaca -> rujuk path saja.
      }
    }
    referenced.push(`- ${f.name}: ${absPath}`);
  }
  const fullText =
    referenced.length === 0
      ? text
      : [text, "Referenced files:", ...referenced].filter((l) => l !== "").join("\n");
  if (blocks.length === 0) return fullText;
  return fullText.trim() === "" ? blocks : [{ type: "text", text: fullText }, ...blocks];
}
