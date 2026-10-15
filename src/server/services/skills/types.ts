/**
 * Kontrak publik Skills_Registry: bentuk data hasil pencarian/audit/instalasi,
 * signature spawn proses, opsi & antarmuka `SkillsRegistry`, plus konstanta
 * bersama yang dipakai modul internal.
 */
import type { AgentType } from "../../../types";
import type { Result } from "../../result";

/** Versi CLI `skills` yang dipin (hindari perubahan perilaku mendadak). */
export const SKILLS_CLI_VERSION = "1.7.0";

export const DEFAULT_BASE_URL = "https://skills.sh";

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
    /** Agent tujuan (`--agent`); default `["opencode"]`. */
    agentTypes?: readonly AgentType[],
  ): Promise<Result<InstallResult>>;
}
