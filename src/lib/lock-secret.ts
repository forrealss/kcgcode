/**
 * Aturan kunci aplikasi (PIN/password) di sisi klien: batas panjang,
 * pembersihan ketikan, dan validasi kunci baru. Logika murni (tanpa DOM) —
 * dipakai welcome screen, Settings -> Security, dan dialog yang meminta
 * kunci saat ini; dipisah agar dapat diuji `bun test`.
 *
 * Batas sama dengan kebijakan server (`server/services/auth/types.ts`). Nilai
 * runtime sengaja tidak diimpor dari kode server ke frontend; server tetap
 * memvalidasi ulang (termasuk pola PIN yang terlalu mudah).
 */
import type { AuthStatus } from "@/server/services/auth";

/** Jenis kunci aplikasi. */
export type LockKind = NonNullable<AuthStatus["lockKind"]>;

export const PIN_MIN = 6;
export const PIN_MAX = 12;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Label jenis kunci untuk UI. */
export function lockLabel(kind: LockKind): string {
  return kind === "pin" ? "PIN" : "password";
}

/** Batas `maxLength` kolom kunci sesuai jenisnya. */
export function secretMaxLength(kind: LockKind): number {
  return kind === "pin" ? PIN_MAX : PASSWORD_MAX;
}

/** Bersihkan ketikan di kolom kunci: PIN hanya angka, password apa adanya. */
export function sanitizeSecretInput(kind: LockKind, value: string): string {
  return kind === "pin" ? value.replace(/\D/g, "") : value;
}

/**
 * Validasi kunci baru + konfirmasinya sebelum dikirim. Kembalikan pesan
 * error untuk UI, atau null bila valid.
 */
export function validateNewLock(kind: LockKind, secret: string, confirm: string): string | null {
  if (kind === "pin" && (secret.length < PIN_MIN || secret.length > PIN_MAX)) {
    return `PIN must be ${PIN_MIN}–${PIN_MAX} digits.`;
  }
  if (kind === "password" && secret.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (secret !== confirm) return `The ${lockLabel(kind)}s don't match.`;
  return null;
}
