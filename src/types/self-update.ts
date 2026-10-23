/**
 * Update KCG Code dari app (Settings -> About): status job instalasi versi
 * baru yang dijalankan server (`bun add -g`), dibaca klien lewat
 * `GET /api/update`.
 */

/**
 * - `idle`: belum ada instalasi.
 * - `installing` / `verifying`: job berjalan.
 * - `restarting`: versi baru terpasang, server akan restart sendiri (daemon).
 * - `installed`: versi baru terpasang, menunggu kcgcode di-restart manual.
 * - `failed`: instalasi gagal (`error`).
 */
export type SelfUpdatePhase =
  | "idle"
  | "installing"
  | "verifying"
  | "restarting"
  | "installed"
  | "failed";

/**
 * Tahap instalasi dari output `bun add` — dasar persentase progres:
 * `preparing` -> `downloading` ("Resolving dependencies") -> `linking`
 * ("Resolved, downloaded and extracted") -> `verifying`.
 */
export type SelfUpdateStep = "preparing" | "downloading" | "linking" | "verifying";

/**
 * Kenapa update tidak bisa dipasang dari app — pengguna menjalankan perintah
 * manual:
 * - `NOT_CLI`: dijalankan dari repo (`bun dev`), bukan binary global.
 * - `NOT_BUN_GLOBAL`: binary tidak berada di folder global Bun (mis. npm).
 */
export type SelfUpdateUnsupported = "NOT_CLI" | "NOT_BUN_GLOBAL";

export interface SelfUpdateStatus {
  phase: SelfUpdatePhase;
  /** Tahap saat `installing` / `verifying`; null di fase lain. */
  step: SelfUpdateStep | null;
  /** Progres 0–100 (per tahap output installer, bukan perkiraan waktu). */
  progress: number;
  /** Versi yang dipasang / terpasang; null saat `idle`. */
  target: string | null;
  /** Kode error domain saat `failed`. */
  error: string | null;
  /** Jumlah baris log installer (kursor `?from=` log). */
  logOffset: number;
  /** null = bisa dipasang dari app. */
  unsupported: SelfUpdateUnsupported | null;
  /**
   * `auto`: server restart sendiri setelah terpasang (mode background).
   * `manual`: pengguna me-restart kcgcode sendiri (dashboard terminal).
   */
  restart: "auto" | "manual";
  /** Session `running` yang akan terhenti saat KCG Code restart. */
  runningSessions: Array<{ id: string; title: string | null }>;
}
