/**
 * Skills_Registry — integrasi katalog skill skills.sh + instalasi via CLI.
 *
 * - Pencarian: `GET https://skills.sh/api/search?q=` — endpoint tanpa auth
 *   yang dipakai CLI resmi (`skills find`). API v1 resmi mewajibkan token
 *   Vercel OIDC, tidak cocok untuk aplikasi lokal.
 * - Audit keamanan: `GET https://skills.sh/api/v1/skills/audit/{id}` (saat
 *   ini dapat diakses tanpa token; 404 = belum pernah diaudit).
 * - Instalasi: `bunx skills@<ver> add <source> --skill <name> --agent
 *   <opencode> <claude-code> -y --json` di direktori Project (satu atau
 *   kedua agent sekaligus). CLI memasang ke
 *   `.agents/skills/<name>/` (dibaca opencode; server headless Project perlu
 *   `POST /instance/dispose` agar daftar skill ter-refresh); untuk Claude
 *   Code ditambah symlink `.claude/skills/<name>/`.
 *
 * Argumen CLI dibangun sebagai array (tanpa shell) dan `source`/`skill`
 * divalidasi ketat sebelum dipakai, sehingga tidak ada celah injeksi.
 *
 * Bagian yang berdiri sendiri ada di `./skills/`: kontrak publik (`types`),
 * validasi input (`validation`), parsing respons API (`parsing`), helper
 * murni CLI (`cli`), spawn proses (`spawn`), cache TTL (`cache`), dan alur
 * instalasi (`install`).
 */
import type { Result } from "../result";
import { createTtlCache } from "./skills/cache";
import { createSkillInstaller } from "./skills/install";
import { parseAuditResponse, parseSearchResponse } from "./skills/parsing";
import { defaultSpawn } from "./skills/spawn";
import {
  DEFAULT_BASE_URL,
  type RegistrySkill,
  type SkillAudit,
  type SkillsRegistry,
  type SkillsRegistryOptions,
} from "./skills/types";
import { isValidSkillId, isValidSource, normalizeQuery } from "./skills/validation";

export { buildInstallArgs, cleanOutputLine, installEnv, parseInstallOutput } from "./skills/cli";
export { parseAuditResponse, parseSearchResponse } from "./skills/parsing";
export { defaultSpawn } from "./skills/spawn";
export type {
  AuditStatus,
  InstallResult,
  RegistrySkill,
  SkillAudit,
  SkillAuditEntry,
  SkillsRegistry,
  SkillsRegistryOptions,
  SpawnFn,
  SpawnResult,
} from "./skills/types";
export { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, SKILLS_CLI_VERSION } from "./skills/types";
export { isValidSkillId, isValidSource, normalizeQuery } from "./skills/validation";

const SEARCH_TIMEOUT_MS = 10_000;
const AUDIT_TIMEOUT_MS = 10_000;

export function createSkillsRegistry(opts: SkillsRegistryOptions = {}): SkillsRegistry {
  const doFetch = opts.fetch ?? fetch;
  const spawn = opts.spawn ?? defaultSpawn;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const now = opts.now ?? Date.now;
  const cache = createTtlCache(now);

  async function search(query: string): Promise<Result<RegistrySkill[]>> {
    const q = normalizeQuery(query);
    if (q === null) return { ok: false, error: "INVALID_SKILL_QUERY" };
    const key = `search:${q.toLowerCase()}`;
    const hit = cache.get<RegistrySkill[]>(key);
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
      cache.set(key, data);
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
    const hit = cache.get<SkillAudit>(key);
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
      cache.set(key, data);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `SKILLS_AUDIT_FAILED: ${(e as Error).message}` };
    }
  }

  return { search, audit, install: createSkillInstaller(spawn) };
}
