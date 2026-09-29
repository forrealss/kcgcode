/**
 * Skills_Registry — integrasi katalog skill skills.sh + instalasi via CLI.
 *
 * - Pencarian: `GET https://skills.sh/api/search?q=` — endpoint tanpa auth
 *   yang dipakai CLI resmi (`skills find`). API v1 resmi mewajibkan token
 *   Vercel OIDC, tidak cocok untuk aplikasi lokal.
 * - Audit keamanan: `GET https://skills.sh/api/v1/skills/audit/{id}` (saat
 *   ini dapat diakses tanpa token; 404 = belum pernah diaudit).
 * - Instalasi: `bunx skills@<ver> add <source> --skill <name> --agent
 *   opencode -y --json` di direktori Project. CLI memasang ke
 *   `.agents/skills/<name>/` yang langsung dibaca opencode; server headless
 *   Project perlu `POST /instance/dispose` agar daftar skill ter-refresh.
 *
 * Argumen CLI dibangun sebagai array (tanpa shell) dan `source`/`skill`
 * divalidasi ketat sebelum dipakai, sehingga tidak ada celah injeksi.
 */
import type { Result } from "../result";

/** Versi CLI `skills` yang dipin (hindari perubahan perilaku mendadak). */
export const SKILLS_CLI_VERSION = "1.7.0";

const DEFAULT_BASE_URL = "https://skills.sh";
const SEARCH_TIMEOUT_MS = 10_000;
const AUDIT_TIMEOUT_MS = 10_000;
/** Instalasi mengunduh repo — beri waktu longgar. */
const INSTALL_TIMEOUT_MS = 180_000;
/** Cache hasil pencarian/audit (skills.sh sendiri cache 30-60 detik). */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** Satu skill hasil pencarian skills.sh. */
export interface RegistrySkill {
  /** `{source}/{skillId}` — stabil, dipakai untuk audit & detail. */
  id: string;
  name: string;
  /** Repo GitHub `owner/repo` atau domain well-known. */
  source: string;
  /** Nama folder skill di repo (argumen `--skill`). */
  skillId: string;
  installs: number;
  /** Halaman skill di skills.sh. */
  url: string;
}

export type AuditStatus = "pass" | "warn" | "fail";

export interface SkillAuditEntry {
  provider: string;
  status: AuditStatus;
  summary: string;
  riskLevel: string | null;
}

export interface SkillAudit {
  /** `null` bila belum ada partner yang mengaudit (404 dari skills.sh). */
  audits: SkillAuditEntry[] | null;
  /** Ringkasan terburuk dari seluruh partner; `null` bila tanpa audit. */
  overall: AuditStatus | null;
}

export interface InstallResult {
  name: string;
  path: string | null;
}

// ---------------------------------------------------------------- validasi ----

/** `owner/repo` GitHub (karakter aman saja). */
const GITHUB_SOURCE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** Sumber well-known berupa domain, mis. `mintlify.com`. */
const DOMAIN_SOURCE_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
/** Nama folder skill: huruf, angka, `.`, `_`, `-`; tidak diawali `-`/`.`. */
const SKILL_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export function isValidSource(source: string): boolean {
  if (source.includes("..")) return false;
  return GITHUB_SOURCE_RE.test(source) || DOMAIN_SOURCE_RE.test(source);
}

export function isValidSkillId(skillId: string): boolean {
  return SKILL_ID_RE.test(skillId) && !skillId.includes("..");
}

/** Normalisasi query pencarian; `null` bila di luar batas panjang. */
export function normalizeQuery(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, " ");
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) return null;
  return q;
}

// ------------------------------------------------------------ parsing murni ----

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Parse respons `/api/search`; entri tak valid / tak aman dibuang. */
export function parseSearchResponse(payload: unknown, baseUrl = DEFAULT_BASE_URL): RegistrySkill[] {
  const skills = (payload as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(skills)) return [];
  const out: RegistrySkill[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const source = str(r.source);
    const skillId = str(r.skillId);
    if (!source || !skillId || !isValidSource(source) || !isValidSkillId(skillId)) continue;
    const id = `${source}/${skillId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: str(r.name) ?? skillId,
      source,
      skillId,
      installs: typeof r.installs === "number" && r.installs >= 0 ? Math.floor(r.installs) : 0,
      url: `${baseUrl}/${id}`,
    });
  }
  return out.sort((a, b) => b.installs - a.installs);
}

const AUDIT_RANK: Record<AuditStatus, number> = { pass: 0, warn: 1, fail: 2 };

/** Parse respons audit; status tak dikenal dianggap `warn` (hati-hati). */
export function parseAuditResponse(payload: unknown): SkillAudit {
  const list = (payload as { audits?: unknown } | null)?.audits;
  if (!Array.isArray(list)) return { audits: null, overall: null };
  const audits: SkillAuditEntry[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const provider = str(r.provider);
    if (!provider) continue;
    const status: AuditStatus =
      r.status === "pass" || r.status === "warn" || r.status === "fail" ? r.status : "warn";
    audits.push({
      provider,
      status,
      summary: str(r.summary) ?? "",
      riskLevel: str(r.riskLevel),
    });
  }
  if (audits.length === 0) return { audits: null, overall: null };
  const overall = audits.reduce<AuditStatus>(
    (worst, a) => (AUDIT_RANK[a.status] > AUDIT_RANK[worst] ? a.status : worst),
    "pass",
  );
  return { audits, overall };
}

/** Argumen `bunx` untuk instalasi (array — tanpa shell). */
export function buildInstallArgs(source: string, skillId: string): string[] {
  return [
    "bunx",
    `skills@${SKILLS_CLI_VERSION}`,
    "add",
    source,
    "--skill",
    skillId,
    "--agent",
    "opencode",
    "-y",
    "--json",
  ];
}

/**
 * Ambil hasil instalasi dari stdout `--json` (array hasil per skill).
 * CLI bisa mencetak teks lain sebelum JSON, jadi cari `[` pertama.
 */
export function parseInstallOutput(stdout: string, skillId: string): Result<InstallResult> {
  const start = stdout.indexOf("[");
  if (start === -1) return { ok: false, error: "SKILL_INSTALL_FAILED" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return { ok: false, error: "SKILL_INSTALL_FAILED" };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "SKILL_INSTALL_FAILED" };
  const entry = parsed.find(
    (e): e is Record<string, unknown> =>
      typeof e === "object" && e !== null && (e as { name?: unknown }).name === skillId,
  );
  const hit = entry ?? (parsed[0] as Record<string, unknown> | undefined);
  if (!hit || (hit.status !== "installed" && hit.status !== "updated")) {
    return { ok: false, error: "SKILL_INSTALL_FAILED" };
  }
  return { ok: true, data: { name: str(hit.name) ?? skillId, path: str(hit.path) } };
}

// ----------------------------------------------------------------- service ----

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Jalankan proses. `onLine` menerima tiap baris stderr begitu tercetak —
 * CLI `skills` mencetak progres ke stderr dan hasil `--json` ke stdout.
 */
export type SpawnFn = (
  args: string[],
  cwd: string,
  timeoutMs: number,
  onLine?: (line: string) => void,
  /** Batalkan proses (beserta seluruh anak-cucunya). */
  signal?: AbortSignal,
) => Promise<SpawnResult>;

export interface SkillsRegistryOptions {
  fetch?: typeof fetch;
  spawn?: SpawnFn;
  baseUrl?: string;
  now?: () => number;
}

export interface SkillsRegistry {
  search(query: string): Promise<Result<RegistrySkill[]>>;
  audit(source: string, skillId: string): Promise<Result<SkillAudit>>;
  /**
   * Pasang skill ke `projectPath`. Instalasi paralel per Project ditolak.
   * `onLine` menerima output CLI (sudah dibersihkan) baris demi baris.
   */
  install(
    projectPath: string,
    source: string,
    skillId: string,
    onLine?: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<Result<InstallResult>>;
}

/** Hapus escape ANSI & karakter kontrol (selain tab) dari satu baris output. */
export function cleanOutputLine(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring escape ANSI
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring escape OSC
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring kontrol
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .trimEnd()
  );
}

/** Baca stream teks, panggil `onLine` per baris utuh; kembalikan seluruh teks. */
async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine?: (line: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let all = "";
  let buf = "";
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    if (!onLine) continue;
    buf += text;
    // `\r` (spinner/progress yang menimpa baris) diperlakukan sebagai akhir baris.
    const parts = buf.split(/\r\n|\n|\r/);
    buf = parts.pop() ?? "";
    for (const part of parts) onLine(part);
  }
  const tail = decoder.decode();
  all += tail;
  buf += tail;
  if (onLine && buf !== "") onLine(buf);
  return all;
}

/**
 * Env proses CLI. Selain mematikan telemetry/warna, `git` (dipakai CLI untuk
 * clone repo) dibuat gagal cepat alih-alih menggantung: tanpa prompt
 * kredensial (repo privat) dan batalkan transfer yang macet (< 1 KB/s
 * selama 30 detik).
 */
export function installEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  return {
    ...env,
    DISABLE_TELEMETRY: "1",
    CI: "1",
    NO_COLOR: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_HTTP_LOW_SPEED_LIMIT: "1000",
    GIT_HTTP_LOW_SPEED_TIME: "30",
  };
}

/**
 * Spawn default: `Bun.spawn` tanpa shell, di process group sendiri
 * (`detached`). Timeout & pembatalan membunuh SELURUH group — `bunx` ->
 * `node` -> `git` — karena membunuh anak langsung saja membuat cucu tetap
 * hidup memegang pipe stdout/stderr sehingga proses tak pernah "selesai".
 */
export const defaultSpawn: SpawnFn = async (args, cwd, timeoutMs, onLine, signal) => {
  const proc = Bun.spawn(args, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: installEnv(process.env),
    detached: true,
  });
  let killed = false;
  const killGroup = () => {
    if (killed) return;
    killed = true;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // Group sudah tidak ada — cukup bunuh proses langsung (idempoten).
      proc.kill("SIGKILL");
    }
  };
  const timer = setTimeout(killGroup, timeoutMs);
  const onAbort = () => killGroup();
  if (signal?.aborted) killGroup();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readLines(proc.stdout),
      readLines(proc.stderr, onLine),
      proc.exited,
    ]);
    return { exitCode: killed ? null : exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};

export function createSkillsRegistry(opts: SkillsRegistryOptions = {}): SkillsRegistry {
  const doFetch = opts.fetch ?? fetch;
  const spawn = opts.spawn ?? defaultSpawn;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; value: unknown }>();
  const installing = new Set<string>();

  function cached<T>(key: string): T | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (now() - hit.at > CACHE_TTL_MS) {
      cache.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  function remember(key: string, value: unknown): void {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: now(), value });
  }

  async function search(query: string): Promise<Result<RegistrySkill[]>> {
    const q = normalizeQuery(query);
    if (q === null) return { ok: false, error: "INVALID_SKILL_QUERY" };
    const key = `search:${q.toLowerCase()}`;
    const hit = cached<RegistrySkill[]>(key);
    if (hit) return { ok: true, data: hit };
    try {
      const params = new URLSearchParams({ q, limit: "50" });
      const res = await doFetch(`${baseUrl}/api/search?${params}`, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (res.status === 429) return { ok: false, error: "SKILLS_RATE_LIMITED" };
      if (!res.ok) return { ok: false, error: `SKILLS_SEARCH_FAILED(${res.status})` };
      const data = parseSearchResponse(await res.json(), baseUrl);
      remember(key, data);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `SKILLS_SEARCH_FAILED: ${(e as Error).message}` };
    }
  }

  async function audit(source: string, skillId: string): Promise<Result<SkillAudit>> {
    if (!isValidSource(source) || !isValidSkillId(skillId)) {
      return { ok: false, error: "INVALID_SKILL_ID" };
    }
    const key = `audit:${source}/${skillId}`;
    const hit = cached<SkillAudit>(key);
    if (hit) return { ok: true, data: hit };
    try {
      const res = await doFetch(`${baseUrl}/api/v1/skills/audit/${source}/${skillId}`, {
        signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      let data: SkillAudit;
      if (res.status === 404) data = { audits: null, overall: null };
      else if (res.ok) data = parseAuditResponse(await res.json());
      else return { ok: false, error: `SKILLS_AUDIT_FAILED(${res.status})` };
      remember(key, data);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `SKILLS_AUDIT_FAILED: ${(e as Error).message}` };
    }
  }

  async function install(
    projectPath: string,
    source: string,
    skillId: string,
    onLine?: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<Result<InstallResult>> {
    if (!isValidSource(source) || !isValidSkillId(skillId)) {
      return { ok: false, error: "INVALID_SKILL_ID" };
    }
    if (installing.has(projectPath)) return { ok: false, error: "SKILL_INSTALL_IN_PROGRESS" };
    installing.add(projectPath);
    // Baris kosong beruntun dirapatkan agar log tetap ringkas.
    let lastBlank = true;
    const emit = (raw: string) => {
      if (!onLine) return;
      const line = cleanOutputLine(raw);
      const blank = line.trim() === "";
      if (blank && lastBlank) return;
      lastBlank = blank;
      onLine(line);
    };
    try {
      const args = buildInstallArgs(source, skillId);
      emit(`$ ${args.join(" ")}`);
      const res = await spawn(args, projectPath, INSTALL_TIMEOUT_MS, emit, signal);
      if (signal?.aborted) {
        emit("Cancelled.");
        return { ok: false, error: "SKILL_INSTALL_CANCELLED" };
      }
      if (res.exitCode !== 0) {
        console.error(
          `[kcg-code] skills add ${source} --skill ${skillId} gagal (exit ${res.exitCode}):`,
          res.stderr.slice(-2000),
        );
        if (res.exitCode === null) {
          emit(`Timed out after ${Math.round(INSTALL_TIMEOUT_MS / 1000)}s — process stopped.`);
          return { ok: false, error: "SKILL_INSTALL_TIMEOUT" };
        }
        emit(`Process exited with code ${res.exitCode}.`);
        return { ok: false, error: "SKILL_INSTALL_FAILED" };
      }
      return parseInstallOutput(res.stdout, skillId);
    } catch (e) {
      console.error("[kcg-code] skills add error:", e);
      emit(`Error: ${(e as Error).message}`);
      return { ok: false, error: "SKILL_INSTALL_FAILED" };
    } finally {
      installing.delete(projectPath);
    }
  }

  return { search, audit, install };
}
