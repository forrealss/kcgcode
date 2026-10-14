/**
 * Anti brute-force: penundaan bertingkat setelah gagal beruntun, dihitung
 * per IP DAN global (tunnel sering menyamarkan IP asli, jadi batas global
 * tetap melindungi). State hanya di memori.
 */

/** Kegagalan beruntun sebelum penundaan mulai berlaku. */
const FREE_ATTEMPTS = 5;
/** Penundaan dasar setelah melewati FREE_ATTEMPTS; berlipat tiap gagal. */
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
/** Batas global lebih longgar (beberapa perangkat sah), tetap bertingkat. */
const GLOBAL_FREE_ATTEMPTS = 20;
/** Lupakan riwayat gagal setelah diam selama ini. */
const FAILURE_RESET_MS = 60 * 60_000;
/** Kunci map untuk penghitung global (tidak mungkin bentrok dengan IP). */
const GLOBAL = "\u0000global";

/** Penundaan setelah `failures` gagal beruntun (0 bila masih bebas). */
export function lockoutMs(failures: number, free: number): number {
  if (failures < free) return 0;
  const steps = failures - free;
  return Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** steps);
}

interface FailureState {
  count: number;
  lastAt: number;
  lockedUntil: number;
}

/** Pencatat kegagalan login per IP + global. */
export class FailureTracker {
  private readonly failures = new Map<string, FailureState>();

  constructor(private readonly now: () => number) {}

  private failureOf(key: string): FailureState {
    const t = this.now();
    const f = this.failures.get(key);
    if (!f || t - f.lastAt > FAILURE_RESET_MS) return { count: 0, lastAt: t, lockedUntil: 0 };
    return f;
  }

  /** Milidetik tunggu sebelum boleh mencoba lagi (maks dari IP & global). */
  retryAfterMs(ip: string): number {
    const t = this.now();
    return Math.max(0, this.failureOf(ip).lockedUntil - t, this.failureOf(GLOBAL).lockedUntil - t);
  }

  recordFailure(ip: string): void {
    const t = this.now();
    for (const [key, free] of [
      [ip, FREE_ATTEMPTS],
      [GLOBAL, GLOBAL_FREE_ATTEMPTS],
    ] as const) {
      const f = this.failureOf(key);
      const count = f.count + 1;
      this.failures.set(key, { count, lastAt: t, lockedUntil: t + lockoutMs(count, free) });
    }
    // Batasi ukuran map (banyak IP berbeda).
    if (this.failures.size > 1000) {
      const oldest = [...this.failures.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
      if (oldest && oldest[0] !== GLOBAL) this.failures.delete(oldest[0]);
    }
  }

  recordSuccess(ip: string): void {
    this.failures.delete(ip);
    // Global dikurangi, bukan dihapus: satu login sah tidak boleh membuka
    // jalan bagi penyerang yang sedang menebak dari IP lain.
    const g = this.failures.get(GLOBAL);
    if (g) this.failures.set(GLOBAL, { ...g, count: Math.max(0, g.count - FREE_ATTEMPTS) });
  }
}
