/**
 * Router URL tipis untuk shell SPA KCG Bridge (tanpa dependency).
 *
 * - Server (`Bun.serve` di `src/server/app.ts`) menyajikan shell SPA untuk
 *   semua path non-API via catch-all `/*`, sehingga tiap halaman boleh punya
 *   URL sendiri; React hanya memetakan `location.pathname` -> view.
 * - Logika murni `parseRoute()` dipisah agar dapat diuji tanpa DOM
 *   (pola yang sama dengan `use-theme.ts`).
 * - `navigate()` memakai History API (`pushState`) + registry listener;
 *   `useRoute()` berlangganan event `popstate` (tombol back/forward browser)
 *   dan registry tersebut (navigasi dari dalam aplikasi).
 */

import { useEffect, useState } from "react";

/** Route hasil parsing `location.pathname`. */
export type AppRoute =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "session"; projectId: string; sessionId: string }
  | { name: "not-found" };

/** URL daftar Project. */
export function projectsPath(): string {
  return "/";
}

/** URL daftar Session milik sebuah Project. */
export function projectPath(projectId: string): string {
  return `/projects/${projectId}`;
}

/** URL Session view milik sebuah Project. */
export function sessionPath(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/sessions/${sessionId}`;
}

/**
 * Pemetaan `pathname` -> `AppRoute`. Segment id dianggap opaque — id
 * Project/Session berupa UUID sehingga aman tanpa decoding. Trailing slash
 * diabaikan (`/projects/x/` sama dengan `/projects/x`).
 */
export function parseRoute(pathname: string): AppRoute {
  const segments = pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return { name: "projects" };
  if (segments[0] !== "projects") return { name: "not-found" };

  const projectId = segments[1];
  if (projectId === undefined || projectId.length === 0) return { name: "not-found" };

  if (segments.length === 2) return { name: "project", projectId };

  if (segments[2] === "sessions" && segments.length === 4) {
    const sessionId = segments[3];
    if (sessionId !== undefined && sessionId.length > 0) {
      return { name: "session", projectId, sessionId };
    }
  }

  return { name: "not-found" };
}

/** Listener perubahan route hasil `navigate()` (popstate ditangani terpisah). */
const listeners = new Set<() => void>();

/**
 * Navigasi SPA: ubah URL tanpa reload halaman, lalu beri tahu subscriber
 * `useRoute()`. Tidak melakukan apa-apa bila History API tidak tersedia.
 */
export function navigate(path: string): void {
  if (typeof window === "undefined" || typeof window.history === "undefined") return;
  window.history.pushState({}, "", path);
  for (const listener of listeners) listener();
}

/**
 * Hook: route saat ini, diperbarui saat navigasi SPA (`navigate()`) maupun
 * tombol back/forward browser (`popstate`).
 */
export function useRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const sync = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", sync);
    listeners.add(sync);
    return () => {
      window.removeEventListener("popstate", sync);
      listeners.delete(sync);
    };
  }, []);

  return route;
}
