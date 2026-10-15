/**
 * Pencarian daftar Session di halaman detail Project (tab "KCG Code" &
 * "Other agents"): cocokkan semua kata kueri, tanpa beda huruf.
 */
import type { ExternalSessionItem } from "@/lib/external-sessions";
import { externalSourceLabel } from "@/lib/external-sessions";
import { describeSessionModel } from "@/lib/session-summary";
import { displaySessionTitle } from "@/lib/session-title";
import type { Session } from "@/types";

/** Semua kata `query` muncul di salah satu `fields` (kueri kosong = cocok). */
export function matchesQuery(
  fields: readonly (string | null | undefined)[],
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields
    .filter((f): f is string => typeof f === "string")
    .join("\n")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** Session KCG: judul tampilan + model. */
export function searchSessions(sessions: readonly Session[], query: string): Session[] {
  return sessions.filter((s) =>
    matchesQuery([displaySessionTitle(s.title), describeSessionModel(s)], query),
  );
}

/** Session agent lain: judul, prompt pertama, asal, branch. */
export function searchExternalSessions(
  sessions: readonly ExternalSessionItem[],
  query: string,
): ExternalSessionItem[] {
  return sessions.filter((s) =>
    matchesQuery([s.title, s.firstPrompt, externalSourceLabel(s), s.gitBranch], query),
  );
}
