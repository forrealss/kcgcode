/**
 * Hook tema (Requirement 8.2, 8.6).
 *
 * - Preferensi: `light`, `dark`, atau `system` (ikuti perangkat), disimpan di
 *   `localStorage["kcg-theme"]`. Tanpa nilai tersimpan -> `system`.
 * - Tema efektif diterapkan ke `<html>` (class `dark`, Requirement 8.6). Pada
 *   `system`, perubahan tema OS diikuti langsung (media query listener).
 * - State dibagi global (satu store modul) sehingga semua pemakai — footer
 *   sidebar, header Session — selalu sinkron, termasuk antar tab (event
 *   `storage`).
 * - `toggleTheme()` tetap ada (Requirement 8.2): berpindah light <-> dark.
 *
 * Logika inti dipisah ke fungsi murni (`resolveTheme`, `resolveInitialTheme`,
 * `applyTheme`, `nextTheme`, `getStoredTheme`, `getStoredPreference`) agar
 * dapat diuji tanpa DOM (bun test).
 */
import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "kcg-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Minimal kontrak storage & root agar dapat di-mock pada unit test. */
export interface ThemeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeRootLike {
  classList: {
    add(name: string): void;
    remove(name: string): void;
    toggle(name: string, force?: boolean): void;
  };
}

// ------------------------------------------------------------ murni ----

/** Tema selanjutnya saat toggle (Requirement 8.2). */
export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** Baca tema eksplisit tersimpan, atau null bila belum ada / `system` / tak dikenal. */
export function getStoredTheme(storage: ThemeStorageLike): Theme | null {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" ? value : null;
}

/** Preferensi tersimpan; kosong / tak dikenal -> `system`. */
export function getStoredPreference(storage: ThemeStorageLike): ThemePreference {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

/** Tema efektif dari preferensi. */
export function resolveTheme(pref: ThemePreference, prefersDark: () => boolean): Theme {
  if (pref === "system") return prefersDark() ? "dark" : "light";
  return pref;
}

/**
 * Tema awal: preferensi tersimpan; bila tidak ada, fallback ke preferensi
 * sistem (`prefers-color-scheme: dark`), lalu light.
 */
export function resolveInitialTheme(stored: string | null, prefersDark: () => boolean): Theme {
  if (stored === "dark" || stored === "light") return stored;
  return prefersDark() ? "dark" : "light";
}

/** Terapkan tema ke elemen root (`classList.toggle("dark", ...)`, Requirement 8.6). */
export function applyTheme(root: ThemeRootLike, theme: Theme): void {
  root.classList.toggle("dark", theme === "dark");
}

// ---------------------------------------------------- store global ----

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
}

const hasDom = typeof window !== "undefined" && typeof document !== "undefined";
const media = hasDom ? window.matchMedia?.(DARK_QUERY) : undefined;
const systemDark = () => Boolean(media?.matches);

function readStorage(): ThemePreference {
  try {
    return typeof localStorage !== "undefined" ? getStoredPreference(localStorage) : "system";
  } catch {
    return "system";
  }
}

let state: ThemeState = (() => {
  const preference = readStorage();
  return { preference, theme: resolveTheme(preference, systemDark) };
})();
const listeners = new Set<() => void>();

function commit(preference: ThemePreference, persist: boolean): void {
  const next: ThemeState = { preference, theme: resolveTheme(preference, systemDark) };
  if (hasDom) applyTheme(document.documentElement, next.theme);
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Storage tidak tersedia — preferensi hanya berlaku di sesi ini.
    }
  }
  if (next.preference === state.preference && next.theme === state.theme) return;
  state = next;
  for (const l of listeners) l();
}

if (hasDom) {
  applyTheme(document.documentElement, state.theme);
  // OS berganti tema -> ikuti bila preferensi `system`.
  media?.addEventListener?.("change", () => {
    if (state.preference === "system") commit("system", false);
  });
  // Tab lain mengubah preferensi -> sinkronkan.
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_STORAGE_KEY) commit(readStorage(), false);
  });
}

export function setThemePreference(preference: ThemePreference): void {
  commit(preference, true);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(): ThemeState {
  return state;
}

// ------------------------------------------------------------ hook ----

export interface UseThemeResult {
  /** Tema efektif yang sedang tampil. */
  theme: Theme;
  /** Pilihan pengguna (termasuk `system`). */
  preference: ThemePreference;
  setPreference(pref: ThemePreference): void;
  /** Light <-> dark (keluar dari `system`). */
  toggleTheme(): void;
}

export function useTheme(): UseThemeResult {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const toggleTheme = useCallback(() => setThemePreference(nextTheme(state.theme)), []);
  return {
    theme: current.theme,
    preference: current.preference,
    setPreference: setThemePreference,
    toggleTheme,
  };
}
