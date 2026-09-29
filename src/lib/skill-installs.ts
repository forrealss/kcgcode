/**
 * Store global job instalasi skill (FE) — sumber data notifikasi instalasi.
 *
 * - `startInstall()` memanggil `POST /api/projects/:id/skills/install` (202)
 *   lalu mem-poll `GET /api/skills/installs/:id?from=<n>` sampai selesai;
 *   baris log baru ditambahkan bertahap (output "live").
 * - Store hidup di modul (bukan komponen) sehingga instalasi & notifikasinya
 *   tetap berjalan saat user pindah halaman atau menutup dialog.
 * - `hydrateInstalls()` memulihkan notifikasi setelah reload: job berjalan
 *   DAN job selesai yang belum ditutup (server menyimpannya ~10 menit), lengkap
 *   dengan log. Status tampilan (disembunyikan / panel output terbuka) disimpan
 *   di localStorage sehingga kembali persis seperti sebelum refresh.
 * - Selesai sukses -> `onInstallFinished` (mis. halaman Skills memuat ulang
 *   daftar terpasang).
 * - Sukses tapi belum aktif (`refreshed: false`, ada chat berjalan) -> polling
 *   pelan berlanjut sampai server mengaktifkannya otomatis setelah chat selesai.
 *
 * `useSyncExternalStore` membaca snapshot; setiap perubahan membuat objek
 * baru (immutable) agar React me-render ulang.
 */
import { useSyncExternalStore } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import type { InstallJob, InstallJobLog } from "@/server/services/skill-install-jobs";

/** Interval polling saat job berjalan. */
const POLL_MS = 700;
/**
 * Interval polling job sukses yang skill-nya belum aktif (menunggu chat di
 * Project selesai lalu agent memuat ulang skill otomatis).
 */
const PENDING_ACTIVATION_POLL_MS = 3000;
/** Berhenti menunggu aktivasi setelah selama ini (chat sangat panjang). */
const PENDING_ACTIVATION_MAX_MS = 30 * 60_000;
/** Batas baris log yang disimpan di client (server juga membatasi). */
const MAX_CLIENT_LINES = 500;

export interface InstallEntry {
  job: InstallJob;
  lines: string[];
  /** Indeks absolut baris berikutnya yang diminta ke server. */
  next: number;
  /** Sebagian baris awal sudah terbuang di server. */
  truncated: boolean;
  /** User menyembunyikan notifikasi ini. */
  dismissed: boolean;
  /** Panel log dibuka. */
  expanded: boolean;
  /** Pesan error jaringan saat polling (job mungkin tetap berjalan). */
  pollError: string | null;
  /** Permintaan pembatalan sudah dikirim (menunggu proses berhenti). */
  cancelling: boolean;
}

type Listener = () => void;

let entries: InstallEntry[] = [];
const listeners = new Set<Listener>();
const finishListeners = new Set<(job: InstallJob) => void>();
const polling = new Set<string>();

function emit(): void {
  for (const l of listeners) l();
}

function update(jobId: string, fn: (e: InstallEntry) => InstallEntry): void {
  let changed = false;
  entries = entries.map((e) => {
    if (e.job.id !== jobId) return e;
    changed = true;
    return fn(e);
  });
  if (changed) emit();
}

function upsert(entry: InstallEntry): void {
  const exists = entries.some((e) => e.job.id === entry.job.id);
  entries = exists
    ? entries.map((e) => (e.job.id === entry.job.id ? entry : e))
    : [entry, ...entries];
  emit();
}

function newEntry(job: InstallJob, expanded: boolean, dismissed = false): InstallEntry {
  return {
    job,
    lines: [],
    next: 0,
    truncated: false,
    dismissed,
    expanded,
    pollError: null,
    cancelling: false,
  };
}

// ------------------------------------------------ status tampilan (persist) ----

const UI_STATE_KEY = "kcg-skill-installs-ui";

/** Status tampilan per job yang bertahan melewati refresh. */
export interface InstallUiState {
  /** Job yang notifikasinya disembunyikan / ditutup user. */
  dismissed: string[];
  /** Job yang panel output-nya terbuka. */
  expanded: string[];
}

function readUiState(): InstallUiState {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return { dismissed: [], expanded: [] };
    const v = JSON.parse(raw) as Partial<InstallUiState>;
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((i) => typeof i === "string") : []);
    return { dismissed: ids(v.dismissed), expanded: ids(v.expanded) };
  } catch {
    return { dismissed: [], expanded: [] };
  }
}

/** Job selesai yang ditutup tidak ada lagi di `entries`; ingat id-nya di sini. */
let closedIds = new Set<string>(readUiState().dismissed);

function saveUiState(): void {
  const state: InstallUiState = {
    dismissed: [
      ...new Set([...closedIds, ...entries.filter((e) => e.dismissed).map((e) => e.job.id)]),
    ],
    expanded: entries.filter((e) => e.expanded).map((e) => e.job.id),
  };
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage tidak tersedia (mode privat) — status hanya di memori.
  }
}

/**
 * Entry yang dipulihkan dari daftar job server (murni — diuji). Job berjalan
 * selalu dipulihkan (walau disembunyikan, agar kartu tetap tahu statusnya);
 * job selesai hanya bila belum ditutup. Urutan: terbaru dulu.
 */
export function hydrationEntries(
  jobs: readonly InstallJob[],
  ui: InstallUiState,
  existingIds: ReadonlySet<string>,
): InstallEntry[] {
  const dismissed = new Set(ui.dismissed);
  const expanded = new Set(ui.expanded);
  return jobs
    .filter((job) => !existingIds.has(job.id))
    .filter((job) => job.status === "running" || !dismissed.has(job.id))
    .map((job) => newEntry(job, expanded.has(job.id), dismissed.has(job.id)));
}

/** Gabungkan potongan log baru ke entry (murni — diuji). */
export function mergeLog(entry: InstallEntry, log: InstallJobLog): InstallEntry {
  // Hanya ambil baris yang belum kita punya (polling bisa tumpang tindih).
  const skip = Math.max(0, entry.next - log.from);
  const fresh = log.lines.slice(skip);
  let lines = fresh.length > 0 ? [...entry.lines, ...fresh] : entry.lines;
  let truncated = entry.truncated || log.truncated;
  if (lines.length > MAX_CLIENT_LINES) {
    lines = lines.slice(lines.length - MAX_CLIENT_LINES);
    truncated = true;
  }
  return {
    ...entry,
    job: log.job,
    lines,
    next: Math.max(entry.next, log.from + log.lines.length),
    truncated,
    pollError: null,
  };
}

async function poll(jobId: string): Promise<void> {
  if (polling.has(jobId)) return;
  polling.add(jobId);
  try {
    for (;;) {
      const cur = entries.find((e) => e.job.id === jobId);
      if (!cur) return;
      try {
        const res = await apiFetch(`/api/skills/installs/${jobId}?from=${cur.next}`);
        const log = (await res.json()) as InstallJobLog;
        const wasRunning = cur.job.status === "running";
        update(jobId, (e) => mergeLog(e, log));
        if (log.job.status !== "running") {
          if (wasRunning) for (const l of finishListeners) l(log.job);
          // Terpasang tapi belum aktif (ada chat berjalan) -> terus pantau
          // pelan sampai server menandai aktif, agar notifikasi ikut berubah.
          const waiting =
            log.job.status === "succeeded" &&
            log.job.refreshed === false &&
            Date.now() - (log.job.finishedAt ?? Date.now()) < PENDING_ACTIVATION_MAX_MS;
          if (!waiting) return;
          await new Promise((r) => setTimeout(r, PENDING_ACTIVATION_POLL_MS));
          continue;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          // Job sudah sukses (sedang menunggu aktivasi) lalu kedaluwarsa /
          // server restart: skill tetap terpasang — jangan ubah jadi gagal.
          // Restart server juga memuat ulang skill, jadi anggap aktif.
          if (cur.job.status === "succeeded") {
            update(jobId, (en) => ({ ...en, job: { ...en.job, refreshed: true } }));
            return;
          }
          // Server restart saat instalasi berjalan: job hilang bersama prosesnya.
          update(jobId, (en) => ({
            ...en,
            job: { ...en.job, status: "failed", error: "INSTALL_JOB_LOST", finishedAt: Date.now() },
            pollError: null,
          }));
          return;
        }
        update(jobId, (en) => ({ ...en, pollError: "Connection lost — retrying…" }));
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    polling.delete(jobId);
  }
}

/**
 * Mulai instalasi. Melempar `ApiError` bila server menolak sebelum job dibuat
 * (validasi, Project tak dikenal, instalasi lain sedang berjalan).
 */
export async function startInstall(
  projectId: string,
  source: string,
  skill: string,
): Promise<InstallJob> {
  const res = await apiFetch(`/api/projects/${projectId}/skills/install`, {
    method: "POST",
    body: JSON.stringify({ source, skill }),
  });
  const { job } = (await res.json()) as { job: InstallJob };
  upsert(newEntry(job, true));
  saveUiState();
  void poll(job.id);
  return job;
}

let hydrated = false;

/**
 * Pulihkan notifikasi setelah reload (sekali per muat halaman): job berjalan
 * + job selesai yang belum ditutup, beserta status tampilannya. Log diambil
 * ulang dari awal; job selesai cukup satu kali ambil.
 */
export async function hydrateInstalls(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const res = await apiFetch("/api/skills/installs");
    const { jobs } = (await res.json()) as { jobs: InstallJob[] };
    const ui = readUiState();
    const restored = hydrationEntries(jobs, ui, new Set(entries.map((e) => e.job.id)));
    // Id yang tidak dikenal server lagi (kedaluwarsa) dibuang dari storage.
    const known = new Set(jobs.map((j) => j.id));
    closedIds = new Set(ui.dismissed.filter((id) => known.has(id)));
    if (restored.length > 0) {
      entries = [...entries, ...restored];
      emit();
    }
    saveUiState();
    for (const e of restored) void poll(e.job.id);
  } catch {
    hydrated = false; // coba lagi di kesempatan berikutnya
  }
}

export function dismissInstall(jobId: string): void {
  update(jobId, (e) => ({ ...e, dismissed: true }));
  // Job selesai yang ditutup tidak perlu disimpan lagi — cukup ingat id-nya
  // agar tidak muncul kembali setelah refresh.
  const e = entries.find((x) => x.job.id === jobId);
  if (e && e.job.status !== "running") {
    closedIds.add(jobId);
    entries = entries.filter((x) => x.job.id !== jobId);
    emit();
  }
  saveUiState();
}

/** Minta server membatalkan job; status akhir datang lewat polling. */
export async function cancelInstall(jobId: string): Promise<void> {
  update(jobId, (e) => ({ ...e, cancelling: true, expanded: true }));
  saveUiState();
  try {
    await apiFetch(`/api/skills/installs/${jobId}/cancel`, { method: "POST" });
  } catch (e) {
    // 409 = sudah selesai duluan; biarkan polling membawa status akhirnya.
    if (!(e instanceof ApiError && e.status === 409)) {
      update(jobId, (en) => ({
        ...en,
        cancelling: false,
        pollError: "Couldn't cancel — try again.",
      }));
    }
  }
}

export function toggleInstallLog(jobId: string): void {
  update(jobId, (e) => ({ ...e, expanded: !e.expanded }));
  saveUiState();
}

/** Tampilkan lagi notifikasi job (mis. klik "Installing…" pada kartu). */
export function revealInstall(jobId: string): void {
  closedIds.delete(jobId);
  update(jobId, (e) => ({ ...e, dismissed: false, expanded: true }));
  saveUiState();
}

/** Berlangganan event "job selesai"; mengembalikan fungsi berhenti. */
export function onInstallFinished(cb: (job: InstallJob) => void): () => void {
  finishListeners.add(cb);
  return () => finishListeners.delete(cb);
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(): InstallEntry[] {
  return entries;
}

export function useInstalls(): InstallEntry[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Job berjalan untuk Project + skill tertentu (untuk status tombol kartu). */
export function findRunningInstall(
  list: readonly InstallEntry[],
  projectId: string,
  source: string,
  skillId: string,
): InstallEntry | undefined {
  return list.find(
    (e) =>
      e.job.status === "running" &&
      e.job.projectId === projectId &&
      e.job.source === source &&
      e.job.skillId === skillId,
  );
}

/** Hanya untuk test: kosongkan store. */
export function __resetInstallsForTest(): void {
  entries = [];
  closedIds = new Set();
  hydrated = false;
  polling.clear();
  emit();
}
