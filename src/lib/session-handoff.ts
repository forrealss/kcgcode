/**
 * Serah-terima homepage -> Session view agar perpindahan tanpa jeda:
 * Session yang baru dibuat (`POST /api/sessions`) dititipkan di memori
 * sehingga `SessionPage` bisa langsung merender tanpa `GET /api/sessions`
 * (tidak ada kilatan "Loading…" di tengah animasi).
 *
 * Hanya di memori (per tab, per kunjungan): refresh halaman kembali ke jalur
 * normal (fetch). Dibaca dengan `peek` (aman untuk StrictMode yang memanggil
 * initializer dua kali) lalu dibersihkan oleh pemakai setelah mount.
 */
import type { Session } from "@/types";

const seeded = new Map<string, Session>();

export function seedSession(session: Session): void {
  seeded.set(session.id, session);
}

export function peekSeededSession(sessionId: string): Session | null {
  return seeded.get(sessionId) ?? null;
}

export function clearSeededSession(sessionId: string): void {
  seeded.delete(sessionId);
}
