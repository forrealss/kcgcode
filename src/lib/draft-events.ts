/**
 * Draf composer tersinkron (lihat `src/types/draft.ts`) dari WS ke composer:
 * `useSessionChat` meneruskan pesan `draft`, composer berlangganan. Draf
 * terakhir per Session disimpan agar composer yang baru dipasang (mis.
 * berganti varian layout) langsung mendapatkannya.
 */
import type { ComposerDraft } from "@/types";

/** Id klien tab ini — penanda `origin` agar siaran balik sendiri diabaikan. */
export const DRAFT_CLIENT_ID = `app-${crypto.randomUUID()}`;

export interface DraftUpdate {
  draft: ComposerDraft;
  origin: string;
}

const latest = new Map<string, DraftUpdate>();
const listeners = new Map<string, Set<(u: DraftUpdate) => void>>();

export function emitDraft(sessionId: string, update: DraftUpdate): void {
  latest.set(sessionId, update);
  for (const fn of listeners.get(sessionId) ?? []) fn(update);
}

/** Catat draf terbaru tanpa memberi tahu pendengar (draf milik tab ini). */
export function rememberDraft(sessionId: string, update: DraftUpdate): void {
  latest.set(sessionId, update);
}

/** Draf terakhir yang diketahui untuk Session ini (bila ada). */
export function latestDraft(sessionId: string): DraftUpdate | null {
  return latest.get(sessionId) ?? null;
}

/** Berlangganan; mengembalikan fungsi berhenti berlangganan. */
export function onDraft(sessionId: string, fn: (u: DraftUpdate) => void): () => void {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}
