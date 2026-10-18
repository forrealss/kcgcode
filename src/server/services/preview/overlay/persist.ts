/**
 * Keadaan overlay yang dibawa melewati reload otomatis ("Reload when the
 * agent finishes") agar overlay terasa tidak ikut ter-reload: sheet
 * terbuka/tertutup, balasan & error agent, fokus kolom pesan, posisi scroll
 * halaman & isi sheet, serta salinan draf (sumber kebenarannya draf Session
 * di server — salinan ini hanya agar tampil seketika, beserta thumbnail
 * gambar lampiran).
 *
 * Disimpan di `sessionStorage` (per tab) sesaat sebelum reload, lalu dipakai
 * sekali saat overlay dimuat.
 */
import { flushDraft, localDraft } from "./draft-sync";
import { state } from "./state";
import { sessionArea, store } from "./storage";
import type { ComposerDraft } from "./types";

const KEY = "__kcg_preview_restore";
/** Snapshot lebih tua dari ini diabaikan (bukan dari reload barusan). */
const MAX_AGE_MS = 30_000;
/**
 * Jeda sebelum reload setelah giliran agent selesai — event `reply` bisa
 * datang sesaat setelah `turn` selesai; tunggu agar balasannya ikut tersimpan.
 */
const RELOAD_DELAY_MS = 500;
/** Sisi terpanjang thumbnail gambar terlampir (px) — kecil agar muat di storage. */
const THUMB_SIDE = 160;
/** Lama mencoba mengembalikan scroll halaman (konten app bisa muncul belakangan). */
const SCROLL_RETRY_MS = 2_000;

export interface Snapshot {
  open: boolean;
  reply: string | null;
  agentError: string | null;
  /** Draf composer (juga ada di server) — agar tampil seketika setelah reload. */
  draft: ComposerDraft;
  /** Thumbnail gambar lampiran (data URL) per id. */
  thumbs: Record<string, string>;
  inputFocused: boolean;
  page: { x: number; y: number };
  sheetScroll: number;
  at: number;
}

/** Bagian UI yang keadaannya ikut disimpan (didaftarkan saat mount). */
export interface UiSource {
  inputFocused: () => boolean;
  sheetScroll: () => number;
}

let ui: UiSource = { inputFocused: () => false, sheetScroll: () => 0 };

export function registerUi(source: UiSource): void {
  ui = source;
}

/** Thumbnail JPEG kecil (data URL) dari URL gambar; "" bila gagal. */
function thumbnail(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, THUMB_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

function save(snap: Snapshot): boolean {
  try {
    sessionArea?.setItem(KEY, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

/** Simpan keadaan lalu muat ulang halaman (setelah jeda singkat). */
export function reloadKeepingState(): void {
  setTimeout(async () => {
    // Draf terbaru dikirim dulu — server adalah sumber kebenarannya.
    await flushDraft();
    const thumbs: Record<string, string> = {};
    await Promise.all(
      state.attachments.map(async (a) => {
        const t = a.url ? await thumbnail(a.url) : "";
        if (t) thumbs[a.id] = t;
      }),
    );
    const snap: Snapshot = {
      open: state.open,
      reply: state.reply,
      agentError: state.agentError,
      draft: localDraft(),
      thumbs,
      inputFocused: ui.inputFocused(),
      page: { x: scrollX, y: scrollY },
      sheetScroll: ui.sheetScroll(),
      at: Date.now(),
    };
    // Storage penuh: korbankan thumbnail (dimuat ulang dari server).
    if (!save(snap)) save({ ...snap, thumbs: {} });
    location.reload();
  }, RELOAD_DELAY_MS);
}

/** Ambil (dan hapus) snapshot dari reload barusan, bila ada. */
export function takeSnapshot(): Snapshot | null {
  const raw = store.get(sessionArea, KEY);
  if (raw === null) return null;
  try {
    sessionArea?.removeItem(KEY);
  } catch {
    // storage diblokir — snapshot kedaluwarsa sendiri lewat `at`
  }
  try {
    const snap = JSON.parse(raw) as Snapshot;
    return Date.now() - snap.at <= MAX_AGE_MS ? snap : null;
  } catch {
    return null;
  }
}

/**
 * Kembalikan scroll halaman. Konten app (SPA) sering baru muncul setelah
 * script-nya jalan, jadi dicoba berulang sebentar — berhenti begitu posisinya
 * tercapai atau pengguna mulai menggulir sendiri.
 */
export function restorePageScroll({ x, y }: { x: number; y: number }): void {
  if (x === 0 && y === 0) return;
  const deadline = Date.now() + SCROLL_RETRY_MS;
  let userMoved = false;
  const stop = () => {
    userMoved = true;
  };
  const opts = { once: true, passive: true } as const;
  for (const type of ["wheel", "touchstart", "keydown"]) addEventListener(type, stop, opts);
  const reached = () => Math.abs(scrollX - x) <= 2 && Math.abs(scrollY - y) <= 2;
  const attempt = () => {
    if (userMoved || reached()) return;
    scrollTo({ left: x, top: y, behavior: "instant" as ScrollBehavior });
    if (!reached() && Date.now() < deadline) setTimeout(attempt, 100);
  };
  attempt();
  addEventListener("load", attempt, { once: true });
}
