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
  throw new Error("Elemen #root tidak ditemukan di index.html");
}
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
if (!import.meta.hot.data.root) {
  import.meta.hot.data.root = createRoot(elem);
}
import.meta.hot.data.root.render(app);

// PWA_Shell (Requirement 8.1): registrasi service worker & inject link manifest
// hanya pada production agar asset statis di-cache untuk instalasi PWA tanpa
// merusak HMR saat dev. Manifest di-inject runtime agar URL tetap `/manifest.json`
// (tidak di-rewrite bundler menjadi hashed asset), disajikan route server.
if (import.meta.env.PROD && typeof document !== "undefined") {
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
