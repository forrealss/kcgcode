/**
 * Overlay Preview (berjalan di halaman app yang di-preview, BUKAN di app
 * KCG Code). Dibundel `overlay-api.ts` menjadi satu IIFE dan disuntik di
 * awal `<head>` setiap dokumen HTML preview.
 *
 * - Tombol melayang kecil (`osd.ts`) dengan titik status agent & jumlah
 *   error console.
 * - Tap -> sheet (`sheet.ts`): toolbar (pilih elemen, screenshot, tampilan
 *   desktop/HP, kembali ke chat); status agent di header + balasan terakhir;
 *   error console (tambahkan ke pesan); composer untuk mengirim pesan +
 *   gambar + elemen terpilih ke Session tanpa meninggalkan preview.
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
import { restoreDraft, syncDraft } from "./draft-sync";
import { createOsd } from "./osd";
import { registerUi, restorePageScroll, takeSnapshot } from "./persist";
import { createSheet, type Sheet } from "./sheet";
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

/**
 * Kembali dari reload otomatis: pulihkan keadaan overlay TANPA animasi
 * buka, supaya overlay terasa tidak ikut ter-reload (lihat persist.ts).
 */
function restoreAfterReload(root: HTMLElement, sheet: Sheet): void {
  const snap = takeSnapshot();
  if (!snap) return;
  state.reply = snap.reply;
  state.agentError = snap.agentError;
  state.open = snap.open;
  restoreDraft(snap.draft, snap.thumbs);

  sheet.skipEnterAnimation();
  root.classList.add("instant");
  notify();
  sheet.setScroll(snap.sheetScroll);
  // Fokus dikembalikan hanya di desktop — di HP akan memunculkan keyboard.
  if (snap.open && snap.inputFocused && matchMedia("(pointer:fine)").matches) sheet.focusInput();
  // Tombol OSD: lepas mode tanpa-transisi setelah frame pertama tergambar
  // (melepas `transition:none` tidak memicu transisi apa pun).
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("instant")));
  restorePageScroll(snap.page);
}

function mount(): void {
  applyViewport();
  const root = createRoot();
  const sheet = createSheet(root, () => osd.el);
  const osd = createOsd(() => {
    state.open = true;
    notify();
    // Desktop: langsung siap mengetik. HP: jangan munculkan keyboard.
    if (matchMedia("(pointer:fine)").matches) setTimeout(sheet.focusInput, 50);
  });
  root.append(osd.el);

  registerUi({ inputFocused: sheet.inputFocused, sheetScroll: sheet.scroll });

  onChange(() => {
    osd.update();
    sheet.update();
    // Lampiran / elemen berubah (ditambah, dihapus, terkirim) -> sinkronkan.
    syncDraft();
  });
  restoreAfterReload(root, sheet);
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
