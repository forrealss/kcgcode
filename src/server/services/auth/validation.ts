/**
 * Util murni Auth_Service: hash token sesi, pembanding waktu-konstan,
 * validasi format kunci, dan deteksi tipe gambar avatar dari isi file.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { LockKind } from "../../db/auth";
import { type AVATAR_MIMES, PASSWORD_MAX, PASSWORD_MIN, PIN_MAX, PIN_MIN } from "./types";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Validasi format kunci; kembalikan kode error atau null. */
export function validateSecret(kind: LockKind, secret: string): string | null {
  if (kind === "pin") {
    if (!/^\d+$/.test(secret)) return "PIN_DIGITS_ONLY";
    if (secret.length < PIN_MIN || secret.length > PIN_MAX) return "PIN_LENGTH";
    // Pola sangat mudah ditebak.
    if (/^(\d)\1+$/.test(secret)) return "PIN_TOO_SIMPLE";
    const asc = "01234567890123456789";
    const desc = "98765432109876543210";
    if (asc.includes(secret) || desc.includes(secret)) return "PIN_TOO_SIMPLE";
    return null;
  }
  if (secret.length < PASSWORD_MIN) return "PASSWORD_TOO_SHORT";
  if (secret.length > PASSWORD_MAX) return "PASSWORD_TOO_LONG";
  if (secret.trim().length === 0) return "PASSWORD_TOO_SHORT";
  return null;
}

/** Deteksi tipe gambar dari magic bytes (jangan percaya MIME dari client). */
export function sniffImageMime(bytes: Uint8Array): (typeof AVATAR_MIMES)[number] | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
