/**
 * Hook tema (Requirement 8.2, 8.6).
 *
 * - Preferensi disimpan di `localStorage["kcg-theme"]`.
 * - Saat mount, preferensi tersimpan diterapkan: class `dark` di-`toggle` pada
 *   `<html>` (Requirement 8.6). Tanpa preferensi, mengikuti preferensi sistem.
 * - `toggleTheme()` mengubah tema saat ini (Requirement 8.2).
 *
 * Logika inti dipisah ke fungsi murni (`resolveInitialTheme`, `applyTheme`,
 * `nextTheme`, `getStoredTheme`) agar dapat diuji tanpa DOM (bun test).
 */
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "kcg-theme";

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

/** Tema selanjutnya saat toggle (Requirement 8.2). */
export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** Baca preferensi tersimpan, atau null bila belum ada / tidak dikenali. */
export function getStoredTheme(storage: ThemeStorageLike): Theme | null {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return value === "dark" || value === "light" ? value : null;
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

export interface UseThemeOptions {
  /** Default: `localStorage` global (browser). */
  storage?: ThemeStorageLike;
  /** Default: `document.documentElement`. */
  root?: ThemeRootLike;
  /** Default: `window.matchMedia("(prefers-color-scheme: dark)")`. */
  prefersDark?: () => boolean;
}

export interface UseThemeResult {
  theme: Theme;
  toggleTheme(): void;
}

export function useTheme(opts: UseThemeOptions = {}): UseThemeResult {
  const storage = opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  const root =
    opts.root ?? (typeof document !== "undefined" ? document.documentElement : undefined);
  const prefersDark =
    opts.prefersDark ??
    (() =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches));

  const [theme, setTheme] = useState<Theme>(() =>
    resolveInitialTheme(storage?.getItem(THEME_STORAGE_KEY) ?? null, prefersDark),
  );

  // Terapkan ke <html> + simpan preferensi setiap tema berubah.
  useEffect(() => {
    if (root) applyTheme(root, theme);
    if (storage) storage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, root, storage]);

  const toggleTheme = useCallback(() => setTheme((t) => nextTheme(t)), []);

  return { theme, toggleTheme };
}
