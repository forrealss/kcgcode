/**
 * Overlay Preview (berjalan di halaman app yang di-preview, BUKAN di app
 * KCG Code). Dibundel `overlay-api.ts` menjadi satu IIFE dan disuntik di
 * awal `<head>` setiap dokumen HTML preview.
 *
 * - Tombol melayang kecil (`osd.ts`) dengan titik status agent & jumlah
 *   error console.
 * - Tap -> sheet (`sheet.ts`): toolbar (reload, screenshot, tampilan
 *   desktop/HP, kembali ke chat, sembunyikan); status agent di header +
 *   balasan terakhir; error console (tambahkan ke pesan); composer untuk
 *   mengirim pesan + gambar ke Session tanpa meninggalkan preview.
 * - Screenshot (Chrome headless di mesin kcgcode) atau foto dari perangkat
 *   bisa dicoret-coret dulu sebelum dilampirkan (`annotator.ts`).
 *
 * Semua UI di shadow root tertutup agar CSS app dan overlay tidak saling
 * memengaruhi. Tanpa framework — script ini ikut dimuat di setiap halaman.
 *
 * CSP app yang ketat (tanpa `'unsafe-inline'`): gaya dipasang lewat
 * constructable stylesheet (tidak tunduk `style-src`) dan CSSOM
 * (`el.style.cssText`), bukan `<style>` / atribut `style`. Izin `connect-src`
 * untuk API overlay ditambahkan proxy di header CSP dokumen.
 *
 * Modul lain bebas efek samping saat di-import; semua dipasang dari sini.
 */
import { listen, loadState } from "./api";
import { captureConsoleErrors } from "./console-capture";
import { h } from "./dom";
import { createOsd } from "./osd";
import { createSheet } from "./sheet";
import { notify, onChange, state } from "./state";
import { CSS } from "./styles";
import { applyViewport } from "./viewport";

/** Host shadow root tertutup + gaya overlay. */
function createRoot(): HTMLElement {
  const host = document.createElement("kcg-preview-overlay");
  // Hindari mewarisi gaya app (mis. `* { display:flex }`).
  host.style.cssText = "all:initial;position:static";
  const shadow = host.attachShadow({ mode: "closed" });
  const root = h("div", { class: "root" });
  // Constructable stylesheet lolos CSP `style-src` app; `<style>` hanya cadangan.
  if ("adoptedStyleSheets" in shadow && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
    shadow.append(root);
  } else {
    shadow.append(h("style", {}, CSS), root);
  }
  document.documentElement.append(host);
  return root;
}

function mount(): void {
  applyViewport();
  const root = createRoot();
  const sheet = createSheet(root);
  const osd = createOsd(() => {
    state.open = true;
    notify();
    // Desktop: langsung siap mengetik. HP: jangan munculkan keyboard.
    if (matchMedia("(pointer:fine)").matches) setTimeout(sheet.focusInput, 50);
  });
  root.append(osd.el);

  onChange(() => {
    osd.update();
    sheet.update();
  });
  notify();
  void loadState();
  listen();
}

const w = window as Window & { __kcgPreview?: boolean };
// Hanya dokumen teratas, sekali saja (iframe app tidak diberi overlay).
if (w.top === w && !w.__kcgPreview) {
  w.__kcgPreview = true;
  // Error console ditangkap sedini mungkin, sebelum script app berjalan.
  captureConsoleErrors();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else mount();
}
