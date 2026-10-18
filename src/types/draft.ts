/**
 * Draf composer Session yang tersinkron antar perangkat & overlay Preview:
 * pesan yang sedang disusun (belum dikirim) beserta lampirannya. Server
 * menyimpan satu draf per Session; tiap perubahan disiarkan ke semua klien
 * Session itu (app via WebSocket, overlay via SSE).
 */

/** Lampiran yang SUDAH diunggah ke Attachment_Store (punya id). */
export interface DraftAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** Elemen halaman preview terpilih — `context` = blok markdown untuk agent. */
export interface DraftElement {
  label: string;
  context: string;
  /**
   * Identitas elemen (selector + tag pembuka). Sama di halaman yang sama =
   * duplikat; sama di halaman lain = komponen yang sama (digabung).
   */
  key: string;
  /** Halaman tempat elemen dipilih (path + query + hash route). */
  pages: string[];
}

export interface ComposerDraft {
  text: string;
  attachments: DraftAttachment[];
  elements: DraftElement[];
}

export const EMPTY_DRAFT: ComposerDraft = { text: "", attachments: [], elements: [] };

/** Batas draf (validasi server). */
export const DRAFT_LIMITS = {
  text: 20_000,
  attachments: 10,
  elements: 8,
  label: 200,
  context: 4_000,
  key: 1_000,
  pages: 10,
  page: 500,
} as const;

export function isEmptyDraft(d: ComposerDraft): boolean {
  return d.text === "" && d.attachments.length === 0 && d.elements.length === 0;
}

/** Sidik draf — dipakai klien untuk tahu apakah ada perubahan yang belum tersinkron. */
export function draftSignature(d: ComposerDraft): string {
  return JSON.stringify([d.text, d.attachments.map((a) => a.id), d.elements]);
}
