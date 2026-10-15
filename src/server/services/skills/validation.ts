/**
 * Validasi input Skills_Registry (murni): `source`/`skillId` divalidasi ketat
 * sebelum dipakai di URL maupun argumen CLI, plus normalisasi query pencarian.
 */
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "./types";

/** `owner/repo` GitHub (karakter aman saja). */
const GITHUB_SOURCE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** Sumber well-known berupa domain, mis. `mintlify.com`. */
const DOMAIN_SOURCE_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
/** Nama folder skill: huruf, angka, `.`, `_`, `-`; tidak diawali `-`/`.`. */
const SKILL_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export function isValidSource(source: string): boolean {
  if (source.includes("..")) return false;
  return GITHUB_SOURCE_RE.test(source) || DOMAIN_SOURCE_RE.test(source);
}

export function isValidSkillId(skillId: string): boolean {
  return SKILL_ID_RE.test(skillId) && !skillId.includes("..");
}

/** Normalisasi query pencarian; `null` bila di luar batas panjang. */
export function normalizeQuery(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, " ");
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) return null;
  return q;
}
