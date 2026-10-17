/**
 * Perubahan file per turn agent, lewat git — tanpa menyentuh repo pengguna.
 *
 * Di awal turn working tree di-snapshot menjadi tree object git memakai
 * index SEMENTARA (`GIT_INDEX_FILE` = salinan index asli, supaya cache stat
 * tetap cepat): `git add -A` + `git write-tree`. Di akhir turn diulang, lalu
 * dua tree dibandingkan. Index, HEAD, cabang, dan file pengguna tidak pernah
 * berubah; yang tertinggal hanya object git tak terjangkau (dibersihkan
 * `git gc` seperti biasa). Perubahan lewat shell (bukan tool edit) ikut
 * tertangkap, `.gitignore` dihormati.
 *
 * Folder Project yang bukan repo git dilewati. Ringkasan per turn disimpan
 * di file JSON per Session (dibatasi `MAX_PER_SESSION`) agar kartu
 * perubahan tetap ada setelah kcgcode restart.
 */

import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TurnDiff, TurnFileChange, TurnFileChangeStatus } from "../../types";
import type { Result } from "../result";

const MAX_PER_SESSION = 50;
const SNAPSHOT_TIMEOUT_MS = 15_000;
const MAX_DIFF_BYTES = 400_000;

/** Diff yang tersimpan beserta tree git-nya (tidak dikirim ke browser). */
interface StoredDiff extends TurnDiff {
  cwd: string;
  from: string;
  to: string;
}

interface Pending {
  cwd: string;
  tree: Promise<string | null>;
  messageId: string | null;
}

export interface TurnDiffsOptions {
  /** Folder penyimpanan ringkasan (`<data>/turn-diffs`). */
  dir: string;
  now?: () => number;
  onDiff?: (diff: TurnDiff) => void;
}

export interface TurnDiffs {
  /** Turn mulai di `cwd` (folder Project). */
  turnStarted(sessionId: string, cwd: string): void;
  /** Pesan assistant di turn yang sedang berjalan (pesan pertama = id grup). */
  noteMessage(sessionId: string, messageId: string): void;
  turnEnded(sessionId: string): Promise<TurnDiff | null>;
  list(sessionId: string): TurnDiff[];
  /** Unified diff satu file pada perubahan `diffId`. */
  fileDiff(sessionId: string, diffId: string, file: string): Promise<Result<string>>;
  removeSession(sessionId: string): void;
}

async function run(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
  timeoutMs = SNAPSHOT_TIMEOUT_MS,
): Promise<{ ok: boolean; out: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    return { ok: code === 0, out };
  } catch {
    return { ok: false, out: "" };
  }
}

/** Tree object working tree `cwd` (tanpa mengubah index asli), atau null. */
export async function snapshotTree(cwd: string): Promise<string | null> {
  const inside = await run(cwd, ["rev-parse", "--is-inside-work-tree"], undefined, 3000);
  if (!inside.ok || inside.out.trim() !== "true") return null;
  const indexPath = await run(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  const tmp = mkdtempSync(path.join(tmpdir(), "kcg-idx-"));
  const tmpIndex = path.join(tmp, "index");
  try {
    const real = indexPath.out.trim();
    // Salinan index asli: stat cache membuat `add -A` cepat di repo besar.
    if (indexPath.ok && real && existsSync(real)) copyFileSync(real, tmpIndex);
    const env = { GIT_INDEX_FILE: tmpIndex, GIT_OPTIONAL_LOCKS: "0" };
    const add = await run(cwd, ["add", "-A", "--", "."], env);
    if (!add.ok) return null;
    const tree = await run(cwd, ["write-tree"], env);
    const hash = tree.out.trim();
    return tree.ok && /^[0-9a-f]{40,64}$/.test(hash) ? hash : null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const STATUS: Record<string, TurnFileChangeStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  T: "modified",
  C: "added",
};

/** Ringkasan file berubah antara dua tree, relatif ke `cwd`. */
export async function diffSummary(
  cwd: string,
  from: string,
  to: string,
): Promise<TurnFileChange[]> {
  const [names, nums] = await Promise.all([
    run(cwd, ["diff", "--relative", "--name-status", "-M", "-z", from, to]),
    run(cwd, ["diff", "--relative", "--numstat", "-M", "-z", from, to]),
  ]);
  if (!names.ok) return [];
  const files: TurnFileChange[] = [];
  const parts = names.out.split("\0").filter((p) => p !== "");
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++] ?? "";
    const kind = STATUS[code[0] ?? ""] ?? "modified";
    if (code[0] === "R" || code[0] === "C") {
      const oldPath = parts[i++] ?? "";
      const newPath = parts[i++] ?? "";
      files.push({ path: newPath, oldPath, status: kind, additions: null, deletions: null });
    } else {
      files.push({ path: parts[i++] ?? "", status: kind, additions: null, deletions: null });
    }
  }
  // numstat -z: "add\tdel\tpath\0" atau untuk rename "add\tdel\t\0old\0new\0".
  const stats = new Map<string, { a: number | null; d: number | null }>();
  const np = nums.out.split("\0");
  for (let i = 0; i < np.length; i++) {
    const entry = np[i] ?? "";
    if (entry === "") continue;
    const [a, d, p] = entry.split("\t");
    const val = { a: a === "-" ? null : Number(a), d: d === "-" ? null : Number(d) };
    if (p === "") {
      i += 2; // old, new
      stats.set(np[i] ?? "", val);
    } else stats.set(p ?? "", val);
  }
  for (const f of files) {
    const s = stats.get(f.path);
    if (s) {
      f.additions = s.a;
      f.deletions = s.d;
    }
  }
  return files;
}

function isSafeFile(file: string): boolean {
  return file !== "" && !file.startsWith("-") && !file.split(/[\\/]/).includes("..");
}

export function createTurnDiffs(opts: TurnDiffsOptions): TurnDiffs {
  const now = opts.now ?? Date.now;
  const pending = new Map<string, Pending>();
  const cache = new Map<string, StoredDiff[]>();

  function fileOf(sessionId: string): string {
    return path.join(opts.dir, `${sessionId.replace(/[^\w-]/g, "_")}.json`);
  }

  function load(sessionId: string): StoredDiff[] {
    let list = cache.get(sessionId);
    if (list) return list;
    try {
      list = JSON.parse(readFileSync(fileOf(sessionId), "utf8")) as StoredDiff[];
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    cache.set(sessionId, list);
    return list;
  }

  function persist(sessionId: string, list: StoredDiff[]): void {
    try {
      mkdirSync(opts.dir, { recursive: true });
      writeFileSync(fileOf(sessionId), JSON.stringify(list));
    } catch (err) {
      console.warn("[kcg-code] gagal menyimpan ringkasan perubahan:", String(err));
    }
  }

  function publicOf(d: StoredDiff): TurnDiff {
    return {
      id: d.id,
      sessionId: d.sessionId,
      messageId: d.messageId,
      files: d.files,
      createdAt: d.createdAt,
    };
  }

  return {
    turnStarted(sessionId, cwd) {
      pending.set(sessionId, { cwd, tree: snapshotTree(cwd), messageId: null });
    },
    noteMessage(sessionId, messageId) {
      const p = pending.get(sessionId);
      if (p && p.messageId === null) p.messageId = messageId;
    },
    async turnEnded(sessionId) {
      const p = pending.get(sessionId);
      if (!p) return null;
      pending.delete(sessionId);
      const from = await p.tree;
      if (!from) return null;
      const to = await snapshotTree(p.cwd);
      if (!to || to === from) return null;
      const files = await diffSummary(p.cwd, from, to);
      if (files.length === 0) return null;
      const diff: StoredDiff = {
        id: randomUUID(),
        sessionId,
        messageId: p.messageId,
        files,
        createdAt: now(),
        cwd: p.cwd,
        from,
        to,
      };
      const list = [...load(sessionId), diff].slice(-MAX_PER_SESSION);
      cache.set(sessionId, list);
      persist(sessionId, list);
      const pub = publicOf(diff);
      opts.onDiff?.(pub);
      return pub;
    },
    list: (sessionId) => load(sessionId).map(publicOf),
    async fileDiff(sessionId, diffId, file) {
      const d = load(sessionId).find((x) => x.id === diffId);
      if (!d) return { ok: false, error: "DIFF_NOT_FOUND" };
      const change = d.files.find((f) => f.path === file);
      if (!change || !isSafeFile(file)) return { ok: false, error: "DIFF_NOT_FOUND" };
      const paths = change.oldPath && isSafeFile(change.oldPath) ? [change.oldPath, file] : [file];
      const res = await run(d.cwd, ["diff", "--relative", "-M", d.from, d.to, "--", ...paths]);
      if (!res.ok) return { ok: false, error: "DIFF_UNAVAILABLE" };
      const text =
        res.out.length > MAX_DIFF_BYTES
          ? `${res.out.slice(0, MAX_DIFF_BYTES)}\n… (truncated)`
          : res.out;
      return { ok: true, data: text };
    },
    removeSession(sessionId) {
      pending.delete(sessionId);
      cache.delete(sessionId);
      rmSync(fileOf(sessionId), { force: true });
    },
  };
}
