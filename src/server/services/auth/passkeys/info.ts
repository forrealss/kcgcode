/**
 * Util murni penamaan & presentasi passkey: nama bawaan dari user agent,
 * sanitasi nama dari user, dan konversi baris DB ke info aman-browser.
 */
import type { PasskeyRow } from "../../../db/auth";
import { PASSKEY_NAME_MAX, type PasskeyInfo } from "./types";

/** Nama passkey bawaan dari user agent (bisa diganti user). */
export function defaultPasskeyName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `Passkey on ${os}` : "Passkey";
}

export function cleanPasskeyName(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length === 0 || clean.length > PASSKEY_NAME_MAX) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring kontrol
  if (/[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

/** Baris DB -> info untuk browser (tanpa kunci publik). */
export function toPasskeyInfo(p: PasskeyRow, rpHere: string | null): PasskeyInfo {
  return {
    id: p.id,
    name: p.name,
    rpId: p.rpId,
    synced: p.backedUp || p.deviceType === "multiDevice",
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
    usableHere: rpHere !== null && p.rpId === rpHere,
  };
}
