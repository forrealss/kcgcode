/**
 * Router URL tipis untuk shell SPA KCG Bridge (tanpa dependency).
 *
 * - Server (`src/server/app.ts`) menyajikan shell SPA hanya untuk rute halaman
 *   yang terdaftar di `src/index.ts` (`spaPaths`), sehingga tiap halaman punya
 *   URL sendiri; `components/layout/AppShell.tsx` memetakan
 *   `location.pathname` -> view via `parseRoute()` di `lib/routes.ts`.
 * - `navigate()` memakai History API (`pushState`) + registry listener;
 *   `useRouter()` berlangganan event `popstate` (tombol back/forward browser)
 *   dan registry tersebut (navigasi dari dalam aplikasi).
 */

import { useCallback, useEffect, useState } from "react";

const ROUTE_CHANGE_EVENT = "kcg-bridge-route-change";

/** Listener perubahan route hasil `navigate()` (popstate ditangani terpisah). */
const listeners = new Set<() => void>();

/**
 * Navigasi SPA: ubah URL tanpa reload halaman, lalu beri tahu subscriber
 * `useRouter()`. Tidak melakukan apa-apa bila History API tidak tersedia.
 */
export function navigate(path: string): void {
  if (typeof window === "undefined" || typeof window.history === "undefined") return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  for (const listener of listeners) listener();
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

  const go = useCallback((path: string) => navigate(path), []);

  return { pathname, navigate: go };
}
