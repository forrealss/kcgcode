/**
 * State overlay bersama + satu pendengar perubahan (`notify` -> render).
 * Tanpa framework: modul lain mengubah `state` lalu memanggil `notify()`.
 */
import { MAX_ERRORS, RELOAD_KEY } from "./config";
import { local, store } from "./storage";
import type { CapturedError, ServerInfo, SessionInfo } from "./types";

export const state = {
  session: null as SessionInfo | null,
  chatUrl: null as string | null,
  server: null as ServerInfo | null,
  turnActive: false,
  attention: false,
  reply: null as string | null,
  agentError: null as string | null,
  open: false,
  hidden: false,
  sending: false,
  sendError: null as string | null,
  autoReload: store.get(local, RELOAD_KEY) === "1",
  /** Chrome headless tersedia di mesin kcgcode. */
  screenshots: false,
  shooting: false,
  annotating: false,
  /** Gambar terunggah yang ikut pesan berikutnya. */
  images: [] as Array<{ id: string; url: string }>,
};

export type OverlayState = typeof state;

/** Error console halaman (terbaru di akhir, digabung per pesan). */
export const errors: CapturedError[] = [];

let listener = () => {};

/** Pasang fungsi render (hanya satu — overlay punya satu pohon UI). */
export function onChange(fn: () => void): void {
  listener = fn;
}

export function notify(): void {
  listener();
}

export function setAutoReload(on: boolean): void {
  state.autoReload = on;
  store.set(local, RELOAD_KEY, on ? "1" : "0");
}

/** Pesan hanya bisa dikirim ke Session yang sedang berjalan. */
export function canSend(): boolean {
  return state.session?.status === "running";
}

export function recordError(message: string, detail = ""): void {
  const msg = message.trim().slice(0, 2000) || "Unknown error";
  const existing = errors.find((e) => e.message === msg);
  if (existing) existing.count++;
  else {
    errors.push({ message: msg, detail: detail.slice(0, 4000), count: 1 });
    if (errors.length > MAX_ERRORS) errors.shift();
  }
  notify();
}

export function clearErrors(): void {
  errors.length = 0;
  notify();
}
