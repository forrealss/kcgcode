/**
 * Router URL tipis untuk shell SPA KCG Code (tanpa dependency).
 *
 * - Server (`src/server/app.ts`) menyajikan shell SPA hanya untuk rute halaman
 *   yang terdaftar di `src/index.ts` (`spaPaths`), sehingga tiap halaman punya
 *   URL sendiri; `components/layout/AppShell.tsx` memetakan
 *   `location.pathname` -> view via `parseRoute()` di `lib/routes.ts`.
 * - `navigate()` memakai History API (`pushState`) + registry listener;
 *   `useRouter()` berlangganan event `popstate` (tombol back/forward browser)
 *   dan registry tersebut (navigasi dari dalam aplikasi).
 * - `navigate(path, { transition })` membungkus perubahan dalam View
 *   Transitions API (bila didukung & pengguna tidak memilih reduced motion):
 *   DOM baru dirender sinkron (`flushSync`) di dalam callback sehingga browser
 *   bisa me-morph elemen bernama `view-transition-name` yang sama antar
 *   halaman. Tanpa dukungan -> navigasi biasa, tanpa animasi.
 */

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

const ROUTE_CHANGE_EVENT = "kcg-code-route-change";

/** Listener perubahan route hasil `navigate()` (popstate ditangani terpisah). */
const listeners = new Set<() => void>();

export interface NavigateOptions {
  /**
   * Nama jenis transisi (mis. "to-session"). Dipasang sebagai atribut
   * `data-vt` di `<html>` selama animasi berjalan agar CSS bisa memilih
   * animasi yang sesuai.
   */
  transition?: string;
}

function commit(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  for (const listener of listeners) listener();
}

function canAnimate(): boolean {
  return (
    typeof document.startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Navigasi SPA: ubah URL tanpa reload halaman, lalu beri tahu subscriber
 * `useRouter()`. Tidak melakukan apa-apa bila History API tidak tersedia.
 */
export function navigate(path: string, options: NavigateOptions = {}): void {
  if (typeof window === "undefined" || typeof window.history === "undefined") return;
  const { transition } = options;
  if (!transition || !canAnimate()) {
    commit(path);
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = transition;
  const vt = document.startViewTransition(() => {
    // Render halaman tujuan secara sinkron agar snapshot "sesudah" lengkap.
    flushSync(() => commit(path));
  });
  void vt.finished.finally(() => {
    if (root.dataset.vt === transition) delete root.dataset.vt;
  });
}

/**
 * Hook: pathname saat ini, diperbarui saat navigasi SPA (`navigate()`) maupun
 * tombol back/forward browser (`popstate`).
 */
export function useRouter(): { pathname: string; navigate: typeof navigate } {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);
    listeners.add(sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
      listeners.delete(sync);
    };
  }, []);

  const go = useCallback((path: string, options?: NavigateOptions) => navigate(path, options), []);

  return { pathname, navigate: go };
}
