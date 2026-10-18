/**
 * Draf composer per Session (lihat `src/types/draft.ts`): penyimpanan di
 * memori + validasi masukan dari klien (WebSocket app & API overlay).
 *
 * Draf tidak dipersist ke disk — cukup selama server hidup; begitu pesan
 * terkirim, klien pengirim menyetel draf kosong.
 */
import { type ComposerDraft, DRAFT_LIMITS, EMPTY_DRAFT, isEmptyDraft } from "../../types";

/** Id lampiran = UUID Attachment_Store. */
const ATTACHMENT_ID = /^[0-9a-fA-F-]{36}$/;
/** Asal perubahan: id klien acak atau "server". */
const ORIGIN = /^[\w-]{1,64}$/;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length <= max ? v : null;

/** Validasi & normalisasi draf dari klien; `null` = tidak valid. */
export function parseDraft(raw: unknown): ComposerDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const text = str(d.text, DRAFT_LIMITS.text);
  if (text === null || !Array.isArray(d.attachments) || !Array.isArray(d.elements)) return null;
  if (d.attachments.length > DRAFT_LIMITS.attachments) return null;
  if (d.elements.length > DRAFT_LIMITS.elements) return null;

  const attachments: ComposerDraft["attachments"] = [];
  for (const a of d.attachments as unknown[]) {
    if (typeof a !== "object" || a === null) return null;
    const r = a as Record<string, unknown>;
    const id = str(r.id, 36);
    const name = str(r.name, 255);
    const mime = str(r.mime, 255);
    if (!id || !ATTACHMENT_ID.test(id) || name === null || mime === null) return null;
    if (typeof r.size !== "number" || !Number.isFinite(r.size) || r.size < 0) return null;
    attachments.push({ id, name, mime, size: r.size });
  }

  const elements: ComposerDraft["elements"] = [];
  for (const e of d.elements as unknown[]) {
    if (typeof e !== "object" || e === null) return null;
    const r = e as Record<string, unknown>;
    const label = str(r.label, DRAFT_LIMITS.label);
    const context = str(r.context, DRAFT_LIMITS.context);
    if (label === null || context === null) return null;
    // `key`/`pages` opsional demi klien lama: tanpa key = label, tanpa pages = [].
    const key = r.key === undefined ? label : str(r.key, DRAFT_LIMITS.key);
    if (key === null) return null;
    const pages = r.pages === undefined ? [] : r.pages;
    if (
      !Array.isArray(pages) ||
      pages.length > DRAFT_LIMITS.pages ||
      !pages.every((p) => typeof p === "string" && p.length <= DRAFT_LIMITS.page)
    ) {
      return null;
    }
    elements.push({ label, context, key, pages: pages as string[] });
  }
  return { text, attachments, elements };
}

export function isValidOrigin(origin: unknown): origin is string {
  return typeof origin === "string" && ORIGIN.test(origin);
}

export interface DraftStore {
  get(sessionId: string): ComposerDraft;
  /** Simpan; `true` bila isinya berubah. */
  set(sessionId: string, draft: ComposerDraft): boolean;
  delete(sessionId: string): void;
}

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, ComposerDraft>();
  return {
    get: (sessionId) => drafts.get(sessionId) ?? EMPTY_DRAFT,
    set(sessionId, draft) {
      const prev = drafts.get(sessionId) ?? EMPTY_DRAFT;
      if (JSON.stringify(prev) === JSON.stringify(draft)) return false;
      if (isEmptyDraft(draft)) drafts.delete(sessionId);
      else drafts.set(sessionId, draft);
      return true;
    },
    delete: (sessionId) => {
      drafts.delete(sessionId);
    },
  };
}
