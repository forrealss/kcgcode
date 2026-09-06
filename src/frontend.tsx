/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element #root not found in index.html");
}
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
//
// API HMR (`import.meta.hot`) hanya ada saat `bun --hot`; pada build produksi
// Bun mengganti/menghilangkannya, jadi pola di bawah memakai guard literal
// `if (import.meta.hot)` yang di-tree-shake bundler saat produksi — blok else
// itulah yang tersisa di bundle produksi (createRoot sekali, tanpa HMR API).
if (import.meta.hot) {
  if (!import.meta.hot.data.root) {
    import.meta.hot.data.root = createRoot(elem);
  }
  import.meta.hot.data.root.render(app);
} else {
  // Produksi: PWA_Shell (Requirement 8.1) — registrasi service worker & inject
  // link manifest hanya di sini agar asset statis di-cache untuk instalasi PWA
  // tanpa merusak HMR saat dev. Manifest di-inject runtime agar URL tetap
  // `/manifest.json` (tidak di-rewrite bundler menjadi hashed asset), disajikan
  // route server.
  createRoot(elem).render(app);

  const manifestLink = document.createElement("link");
  manifestLink.rel = "manifest";
  manifestLink.href = "/manifest.json";
  document.head.appendChild(manifestLink);

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Gagal registrasi SW tidak menghalangi aplikasi.
    });
  }
}
