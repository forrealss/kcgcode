#!/usr/bin/env bun
/**
 * EKSPERIMEN: tampilkan Session Claude Code dari KCG / CLI di sidebar tab Code
 * Claude Desktop, agar bisa dilanjutkan di sana.
 *
 * Claude Desktop tidak punya cara resmi untuk ini. Script ini meniru record
 * yang ditulis importer "terminal-cli" bawaan Desktop (yang di-gate flag
 * server dan belum aktif untuk semua akun): satu berkas
 * `<desktop>/claude-code-sessions/<akun>/<org>/local_<uuid>.json` yang
 * menunjuk transcript yang sudah ada di `~/.claude/projects` (id sama ->
 * Desktop dan KCG melanjutkan transcript yang sama; jangan jalankan keduanya
 * bersamaan). Format record internal Desktop dan bisa berubah kapan saja.
 *
 * Desktop memuat record hanya saat start, jadi Desktop HARUS ditutup penuh.
 * Sebelum menulis, seluruh `claude-code-sessions` dibackup sekali.
 *
 *   bun scripts/desktop-handoff.ts add <claude-session-id> [--title "…"] [--dry-run]
 *   bun scripts/desktop-handoff.ts list
 *   bun scripts/desktop-handoff.ts undo     # hapus semua record buatan script ini
 *
 * Lingkungan: CLAUDE_CONFIG_DIR (default ~/.claude), CLAUDE_DESKTOP_DIR
 * (default ~/.config/Claude).
 */
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, ".claude");
const DEFAULT_DESKTOP_DIR = path.join(HOME, ".config", "Claude");
const DESKTOP_DIR = process.env.CLAUDE_DESKTOP_DIR ?? DEFAULT_DESKTOP_DIR;
/** Cek "Desktop harus ditutup" hanya bermakna untuk folder data Desktop asli. */
const REAL_DESKTOP = path.resolve(DESKTOP_DIR) === DEFAULT_DESKTOP_DIR;
const SESSIONS_DIR = path.join(DESKTOP_DIR, "claude-code-sessions");
/** Daftar record buatan script (di luar folder Desktop agar tidak ikut dibaca). */
const MANIFEST = path.join(path.dirname(DESKTOP_DIR), "kcg-desktop-handoff.json");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ManifestEntry {
  file: string;
  cliSessionId: string;
  title: string;
  createdAt: number;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** Proses Claude Desktop yang hidup (argv[0] berakhiran `/claude-desktop`). */
function desktopRunning(): boolean {
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const argv0 = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0] ?? "";
      if (path.basename(argv0) === "claude-desktop") return true;
    } catch {
      // proses sudah selesai
    }
  }
  return false;
}

async function readManifest(): Promise<ManifestEntry[]> {
  const f = Bun.file(MANIFEST);
  return (await f.exists()) ? ((await f.json()) as ManifestEntry[]) : [];
}

/** Folder akun/org aktif = yang berisi record Desktop paling baru diubah. */
function activeStorageDir(): string {
  let best: { dir: string; mtime: number } | null = null;
  for (const account of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
    if (!account.isDirectory() || !UUID.test(account.name)) continue;
    const accountDir = path.join(SESSIONS_DIR, account.name);
    for (const org of readdirSync(accountDir, { withFileTypes: true })) {
      if (!org.isDirectory() || !UUID.test(org.name)) continue;
      const dir = path.join(accountDir, org.name);
      for (const f of readdirSync(dir)) {
        if (!f.startsWith("local_") || !f.endsWith(".json")) continue;
        const mtime = statSync(path.join(dir, f)).mtimeMs;
        if (!best || mtime > best.mtime) best = { dir, mtime };
      }
    }
  }
  if (!best)
    fail(`No Desktop Code sessions found under ${SESSIONS_DIR}; open the Code tab once first.`);
  return best.dir;
}

/** cliSessionId yang sudah dimiliki Desktop (di folder aktif). */
function ownedCliIds(dir: string): Set<string> {
  const ids = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("local_") || !f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { cliSessionId?: string };
      if (rec.cliSessionId) ids.add(rec.cliSessionId);
    } catch {
      // record rusak bukan urusan script ini
    }
  }
  return ids;
}

function findTranscript(id: string): string {
  const projects = path.join(CLAUDE_DIR, "projects");
  for (const dir of readdirSync(projects)) {
    const file = path.join(projects, dir, `${id}.jsonl`);
    if (existsSync(file)) return file;
  }
  fail(`Transcript ${id}.jsonl not found under ${projects}.`);
}

/** cwd, judul, dan waktu dari transcript. */
function inspectTranscript(file: string): {
  cwd: string;
  title: string | null;
  createdAt: number;
  lastActivityAt: number;
} {
  let cwd: string | null = null;
  let title: string | null = null;
  let firstPrompt: string | null = null;
  let createdAt = Number.NaN;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof ev.cwd === "string") cwd = ev.cwd;
    if (Number.isNaN(createdAt) && typeof ev.timestamp === "string") {
      createdAt = Date.parse(ev.timestamp);
    }
    if (ev.type === "summary" && typeof ev.summary === "string") title = ev.summary;
    if ((ev.type === "custom-title" || ev.type === "ai-title") && typeof ev.title === "string") {
      title = ev.title;
    }
    if (!firstPrompt && ev.type === "user") {
      const content = (ev.message as { content?: unknown } | undefined)?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? (content.find((c) => c?.type === "text")?.text as string | undefined)
            : undefined;
      if (text && !text.startsWith("<")) firstPrompt = text.trim().split("\n")[0] ?? null;
    }
  }
  if (!cwd) fail(`Could not find the working directory in ${file}.`);
  const mtime = Math.round(statSync(file).mtimeMs);
  return {
    cwd,
    title: title ?? (firstPrompt ? firstPrompt.slice(0, 60) : null),
    createdAt: Number.isNaN(createdAt) ? mtime : createdAt,
    lastActivityAt: mtime,
  };
}

async function add(id: string, titleArg: string | undefined, dryRun: boolean) {
  if (!UUID.test(id)) fail(`"${id}" is not a Claude session id (UUID).`);
  if (!existsSync(SESSIONS_DIR)) fail(`${SESSIONS_DIR} does not exist.`);
  if (!dryRun && REAL_DESKTOP && desktopRunning()) {
    fail(
      "Claude Desktop is running. Quit it completely first (it only reads sessions at startup).",
    );
  }

  const transcript = findTranscript(id);
  const info = inspectTranscript(transcript);
  const dir = activeStorageDir();
  if (ownedCliIds(dir).has(id)) fail("Claude Desktop already has this session.");

  const sessionId = `local_${randomUUID()}`;
  const now = Date.now();
  const title = titleArg ?? info.title ?? "Session from KCG Code";
  // Bentuk record importer "terminal-cli" Desktop; tanpa stagedTranscriptPath
  // karena transcript sudah berada di ~/.claude/projects.
  const record = {
    sessionId,
    cliSessionId: id,
    cwd: info.cwd,
    originCwd: info.cwd,
    title,
    createdAt: info.createdAt,
    lastActivityAt: info.lastActivityAt,
    indexedAt: now,
    isArchived: false,
    importedFrom: "terminal-cli",
    adoptedFromOtherSurface: true,
  };
  const file = path.join(dir, `${sessionId}.json`);

  console.log(`transcript : ${transcript}`);
  console.log(`cwd        : ${info.cwd}`);
  console.log(`title      : ${title}`);
  console.log(`record     : ${file}`);
  if (dryRun) {
    console.log(`\n(dry run) record would be:\n${JSON.stringify(record, null, 2)}`);
    return;
  }

  const manifest = await readManifest();
  if (manifest.length === 0 || !manifest.some((m) => existsSync(m.file))) {
    const backup = `${SESSIONS_DIR}.kcg-backup-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
    cpSync(SESSIONS_DIR, backup, { recursive: true });
    console.log(`backup     : ${backup}`);
  }
  await Bun.write(file, JSON.stringify(record));
  manifest.push({ file, cliSessionId: id, title, createdAt: now });
  await Bun.write(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log("\n✓ Added. Start Claude Desktop and look in the Code tab sidebar.");
}

async function list() {
  const manifest = await readManifest();
  if (manifest.length === 0) return console.log("No records added by this script.");
  for (const m of manifest) {
    console.log(`${existsSync(m.file) ? "•" : "×"} ${m.title}  (${m.cliSessionId})\n  ${m.file}`);
  }
}

async function undo() {
  if (REAL_DESKTOP && desktopRunning())
    fail("Claude Desktop is running. Quit it completely first.");
  const manifest = await readManifest();
  for (const m of manifest) {
    if (existsSync(m.file)) {
      rmSync(m.file);
      console.log(`removed ${m.file}`);
    }
  }
  rmSync(MANIFEST, { force: true });
  console.log(
    "✓ Done. The backup folder (claude-code-sessions.kcg-backup-*) is kept; delete it when you're sure.",
  );
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : (rest[i + 1] ?? "");
};
if (cmd === "add" && rest[0]) await add(rest[0], flag("--title"), rest.includes("--dry-run"));
else if (cmd === "list") await list();
else if (cmd === "undo") await undo();
else {
  console.log(
    'Usage:\n  bun scripts/desktop-handoff.ts add <claude-session-id> [--title "…"] [--dry-run]\n  bun scripts/desktop-handoff.ts list\n  bun scripts/desktop-handoff.ts undo',
  );
  process.exit(cmd ? 1 : 0);
}
