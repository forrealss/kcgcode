/**
 * Sinkronisasi draf composer overlay <-> Session (app KCG Code & perangkat
 * lain). Server menyimpan satu draf per Session; overlay mengirim
 * perubahannya (POST `draft`) dan menerima perubahan pihak lain lewat SSE.
 *
 * - Teks dikirim setelah jeda mengetik singkat; lampiran/elemen & draf
 *   kosong (pesan terkirim) dikirim seketika.
 * - Siaran balik milik sendiri diabaikan lewat `origin` (id klien acak).
 * - Snapshot dari server (`origin: "server"`, saat terhubung) tidak menimpa
 *   perubahan lokal yang belum tersinkron — justru draf lokal yang dikirim.
 * - Gambar lampiran dari perangkat lain dimuat lewat `attachment/:id`.
 */
import { API } from "./config";
import { notify, state } from "./state";
import type { ComposerDraft, OverlayAttachment } from "./types";

const TEXT_DEBOUNCE_MS = 300;
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const CLIENT_ID = `overlay-${crypto.randomUUID()}`;

let readText: () => string = () => "";
let writeText: (text: string) => void = () => {};
/** Composer mendaftarkan akses ke textarea-nya. */
export function registerText(read: () => string, write: (text: string) => void): void {
  readText = read;
  writeText = write;
}

const EMPTY: ComposerDraft = { text: "", attachments: [], elements: [] };
/** Draf terakhir yang diketahui sama di server (dikirim atau diterima). */
let synced: ComposerDraft = EMPTY;
let timer = 0;

const signature = (d: ComposerDraft) =>
  JSON.stringify([d.text, d.attachments.map((a) => a.id), d.elements]);
const isEmpty = (d: ComposerDraft) =>
  d.text === "" && d.attachments.length === 0 && d.elements.length === 0;

export function localDraft(): ComposerDraft {
  return {
    text: readText(),
    attachments: state.attachments.map(({ id, name, mime, size }) => ({ id, name, mime, size })),
    elements: state.elements.map(({ label, context, key, pages }) => ({
      label,
      context,
      key,
      pages,
    })),
  };
}

async function post(draft: ComposerDraft): Promise<void> {
  const prev = synced;
  synced = draft;
  try {
    const res = await fetch(`${API}draft`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft, origin: CLIENT_ID }),
    });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    // Gagal: tandai belum tersinkron agar perubahan berikutnya mencoba lagi.
    if (synced === draft) synced = prev;
  }
}

/**
 * Kirim draf lokal bila berubah. Hanya teks yang berubah -> tunggu jeda
 * mengetik; selain itu (atau draf kosong) -> seketika.
 */
export function syncDraft(): void {
  if (!state.session) return;
  const draft = localDraft();
  if (signature(draft) === signature(synced)) {
    clearTimeout(timer);
    return;
  }
  const textOnly = signature({ ...draft, text: synced.text }) === signature(synced);
  clearTimeout(timer);
  if (textOnly && !isEmpty(draft)) {
    timer = window.setTimeout(() => void post(localDraft()), TEXT_DEBOUNCE_MS);
  } else {
    void post(draft);
  }
}

/** Kirim sekarang juga (mis. sebelum reload otomatis). */
export async function flushDraft(): Promise<void> {
  clearTimeout(timer);
  if (!state.session) return;
  const draft = localDraft();
  if (signature(draft) !== signature(synced)) await post(draft);
}

/** Muat pratinjau gambar lampiran dari server (blob agar lolos CSP `img-src`). */
async function loadPreview(att: OverlayAttachment): Promise<void> {
  try {
    const res = await fetch(`${API}attachment/${encodeURIComponent(att.id)}`, {
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const live = state.attachments.find((a) => a.id === att.id);
    if (live) {
      live.url = url;
      notify();
    } else URL.revokeObjectURL(url);
  } catch {
    // tanpa pratinjau — chip nama file tetap tampil
  }
}

/**
 * Pulihkan draf lokal setelah reload otomatis (tampil seketika, sebelum
 * respons server). `thumbs` = pratinjau gambar yang dibawa melewati reload.
 */
export function restoreDraft(draft: ComposerDraft, thumbs: Record<string, string>): void {
  synced = draft;
  writeText(draft.text);
  state.elements = draft.elements.map((e) => ({ ...e }));
  state.attachments = draft.attachments.map((a) => {
    const item: OverlayAttachment = { ...a, url: thumbs[a.id] ?? null };
    if (!item.url && PREVIEWABLE.has(a.mime)) void loadPreview(item);
    return item;
  });
}

/** Terapkan draf dari server / perangkat lain. */
export function applyRemoteDraft(draft: ComposerDraft, origin: string): void {
  if (origin === CLIENT_ID) return;
  // Snapshot server saat terhubung, padahal ada perubahan lokal yang belum
  // terkirim (mis. koneksi sempat putus): lokal menang, kirim ulang.
  if (origin === "server" && signature(localDraft()) !== signature(synced)) {
    synced = draft;
    syncDraft();
    return;
  }
  clearTimeout(timer);
  synced = draft;
  if (readText() !== draft.text) writeText(draft.text);
  state.elements = draft.elements.map((e) => ({ ...e }));
  const prev = new Map(state.attachments.map((a) => [a.id, a]));
  state.attachments = draft.attachments.map((a) => {
    const known = prev.get(a.id);
    if (known) return known;
    const fresh: OverlayAttachment = { ...a, url: null };
    if (PREVIEWABLE.has(a.mime)) void loadPreview(fresh);
    return fresh;
  });
  for (const [id, a] of prev) {
    if (a.url && !state.attachments.some((x) => x.id === id)) URL.revokeObjectURL(a.url);
  }
  notify();
}
