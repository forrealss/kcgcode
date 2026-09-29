/**
 * Skill_Install_Jobs — instalasi skill sebagai job latar dengan log live.
 *
 * `POST /api/projects/:id/skills/install` membuat job lalu langsung kembali
 * (202); CLI `skills` berjalan di belakang dan setiap baris output-nya
 * dicatat. Client mengambil log bertahap lewat `GET /api/skills/installs/:id
 * ?from=<n>` sehingga output tampil hampir real-time dan instalasi tetap
 * berjalan walau user pindah halaman / menutup dialog.
 *
 * Job disimpan di memori (hilang saat server restart — wajar untuk proses
 * yang memang ikut mati). Log dibatasi `MAX_LOG_LINES`; job selesai dibuang
 * setelah `FINISHED_TTL_MS` agar memori tidak tumbuh terus.
 */
import { randomUUID } from "node:crypto";
import type { Result } from "../result";
import type { InstallResult, SkillsRegistry } from "./skills-registry";

export const MAX_LOG_LINES = 500;
const MAX_LINE_LENGTH = 1000;
/** Job selesai tetap bisa dibaca selama ini (UI sempat menampilkan hasil). */
export const FINISHED_TTL_MS = 10 * 60_000;

export type InstallJobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface InstallJob {
  id: string;
  projectId: string;
  projectName: string;
  source: string;
  skillId: string;
  status: InstallJobStatus;
  /** Kode error domain bila `failed`. */
  error: string | null;
  /** `false` = terpasang tapi server opencode belum di-refresh (ada chat aktif). */
  refreshed: boolean | null;
  installedPath: string | null;
  startedAt: number;
  finishedAt: number | null;
  /** Waktu baris output terakhir (untuk petunjuk "tidak ada output"). */
  lastOutputAt: number;
  /** Jumlah total baris log sejak awal (termasuk yang sudah terbuang). */
  lineCount: number;
}

/** Potongan log mulai indeks `from` (indeks absolut sejak awal job). */
export interface InstallJobLog {
  job: InstallJob;
  /** Indeks absolut baris pertama pada `lines`. */
  from: number;
  lines: string[];
  /** Ada baris lama yang sudah terbuang sebelum `from` yang diminta. */
  truncated: boolean;
}

export interface StartInstallInput {
  projectId: string;
  projectName: string;
  projectPath: string;
  source: string;
  skillId: string;
}

export interface SkillInstallJobs {
  /**
   * Mulai job. Validasi & cek "sedang berjalan" dilakukan sinkron agar
   * pemanggil bisa membalas 400/409 sebelum job dibuat.
   */
  start(input: StartInstallInput): Result<InstallJob>;
  get(jobId: string, from?: number): InstallJobLog | null;
  /** Job berjalan + yang baru selesai (terbaru dulu). */
  list(): InstallJob[];
  /** Batalkan job berjalan (membunuh proses CLI). `false` bila tidak berjalan. */
  cancel(jobId: string): boolean;
  /**
   * Refresh skill yang tertunda untuk Project baru saja berjalan otomatis:
   * job sukses dengan `refreshed: false` ditandai aktif + dicatat di log.
   */
  markRefreshed(projectId: string): void;
  /** Batalkan semua job berjalan lalu tunggu selesai (shutdown server). */
  cancelAll(): Promise<void>;
  /** Menunggu job selesai (untuk test & shutdown). */
  settled(jobId: string): Promise<void>;
}

export interface SkillInstallJobsOptions {
  registry: SkillsRegistry;
  /** Refresh skill server opencode Project setelah terpasang. */
  refreshSkills: (projectId: string) => Promise<Result<{ refreshed: boolean }>>;
  now?: () => number;
  /** Validasi source/skill sebelum job dibuat. */
  validate: (source: string, skillId: string) => boolean;
}

interface JobState {
  job: InstallJob;
  lines: string[];
  /** Indeks absolut baris pertama yang masih disimpan di `lines`. */
  offset: number;
  done: Promise<void>;
  abort: AbortController;
}

export function createSkillInstallJobs(opts: SkillInstallJobsOptions): SkillInstallJobs {
  const now = opts.now ?? Date.now;
  const jobs = new Map<string, JobState>();

  function prune(): void {
    const cutoff = now() - FINISHED_TTL_MS;
    for (const [id, st] of jobs) {
      if (st.job.finishedAt !== null && st.job.finishedAt < cutoff) jobs.delete(id);
    }
  }

  function push(st: JobState, raw: string): void {
    const line = raw.length > MAX_LINE_LENGTH ? `${raw.slice(0, MAX_LINE_LENGTH)}…` : raw;
    st.lines.push(line);
    st.job.lineCount += 1;
    st.job.lastOutputAt = now();
    if (st.lines.length > MAX_LOG_LINES) {
      const drop = st.lines.length - MAX_LOG_LINES;
      st.lines.splice(0, drop);
      st.offset += drop;
    }
  }

  function finish(st: JobState, status: InstallJobStatus, extra: Partial<InstallJob>): void {
    Object.assign(st.job, extra, { status, finishedAt: now() });
  }

  async function run(st: JobState, projectPath: string): Promise<void> {
    const { job } = st;
    const signal = st.abort.signal;
    let res: Result<InstallResult>;
    try {
      res = await opts.registry.install(
        projectPath,
        job.source,
        job.skillId,
        (l) => push(st, l),
        signal,
      );
    } catch (e) {
      res = { ok: false, error: "SKILL_INSTALL_FAILED" };
      push(st, `Error: ${(e as Error).message}`);
    }
    if (signal.aborted) {
      push(st, "✗ Installation cancelled.");
      finish(st, "cancelled", { error: "SKILL_INSTALL_CANCELLED" });
      return;
    }
    if (!res.ok) {
      push(st, "✗ Installation failed.");
      finish(st, "failed", { error: res.error });
      return;
    }
    push(st, "Reloading the agent's skill list…");
    let refreshed = false;
    try {
      const r = await opts.refreshSkills(job.projectId);
      refreshed = r.ok ? r.data.refreshed : false;
    } catch {
      refreshed = false;
    }
    push(
      st,
      refreshed
        ? `✓ Installed ${res.data.name}.`
        : `✓ Installed ${res.data.name}. A chat is running in this project — the agent reloads skills automatically when it finishes.`,
    );
    finish(st, "succeeded", { refreshed, installedPath: res.data.path });
  }

  function start(input: StartInstallInput): Result<InstallJob> {
    prune();
    if (!opts.validate(input.source, input.skillId)) {
      return { ok: false, error: "INVALID_SKILL_ID" };
    }
    for (const st of jobs.values()) {
      if (st.job.projectId === input.projectId && st.job.status === "running") {
        return { ok: false, error: "SKILL_INSTALL_IN_PROGRESS" };
      }
    }
    const job: InstallJob = {
      id: randomUUID(),
      projectId: input.projectId,
      projectName: input.projectName,
      source: input.source,
      skillId: input.skillId,
      status: "running",
      error: null,
      refreshed: null,
      installedPath: null,
      startedAt: now(),
      finishedAt: null,
      lastOutputAt: now(),
      lineCount: 0,
    };
    const st: JobState = {
      job,
      lines: [],
      offset: 0,
      done: Promise.resolve(),
      abort: new AbortController(),
    };
    jobs.set(job.id, st);
    st.done = run(st, input.projectPath);
    return { ok: true, data: { ...job } };
  }

  function get(jobId: string, from = 0): InstallJobLog | null {
    const st = jobs.get(jobId);
    if (!st) return null;
    const start = Math.max(0, Math.floor(from));
    const idx = Math.max(0, start - st.offset);
    return {
      job: { ...st.job },
      from: Math.max(start, st.offset),
      lines: st.lines.slice(idx),
      truncated: start < st.offset,
    };
  }

  function list(): InstallJob[] {
    prune();
    return [...jobs.values()]
      .map((st) => ({ ...st.job }))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  function cancel(jobId: string): boolean {
    const st = jobs.get(jobId);
    if (st?.job.status !== "running" || st.abort.signal.aborted) return false;
    push(st, "Cancelling…");
    st.abort.abort();
    return true;
  }

  function markRefreshed(projectId: string): void {
    for (const st of jobs.values()) {
      if (
        st.job.projectId === projectId &&
        st.job.status === "succeeded" &&
        st.job.refreshed === false
      ) {
        st.job.refreshed = true;
        push(st, `✓ Chat finished — ${st.job.skillId} is now active.`);
      }
    }
  }

  async function cancelAll(): Promise<void> {
    const running = [...jobs.values()].filter((st) => st.job.status === "running");
    for (const st of running) st.abort.abort();
    await Promise.all(running.map((st) => st.done));
  }

  async function settled(jobId: string): Promise<void> {
    await jobs.get(jobId)?.done;
  }

  return { start, get, list, cancel, markRefreshed, cancelAll, settled };
}
