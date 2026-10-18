/** Tampilan desktop (viewport lebar) — berlaku sampai tab ditutup. */
import { VIEW_KEY } from "./config";
import { sessionArea, store } from "./storage";

let desktop = store.get(sessionArea, VIEW_KEY) === "desktop";

export function isDesktop(): boolean {
  return desktop;
}

export function setDesktop(on: boolean): void {
  desktop = on;
  store.set(sessionArea, VIEW_KEY, on ? "desktop" : "device");
  applyViewport();
}

/** Ganti `<meta name="viewport">`; nilai asli disimpan agar bisa kembali. */
export function applyViewport(): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    if (!desktop) return;
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head?.appendChild(meta);
  }
  if (!meta.dataset.kcgOriginal) {
    meta.dataset.kcgOriginal = meta.content || "width=device-width, initial-scale=1";
  }
  meta.content = desktop ? "width=1280" : meta.dataset.kcgOriginal;
}
