/**
 * Unit test persistensi tema (task 22.2, Requirement 8.2 & 8.6).
 *
 * `bun test` tidak menyediakan DOM, sehingga hook diuji lewat fungsi murni
 * (`resolveInitialTheme`, `applyTheme`, `nextTheme`, `getStoredTheme`) dengan
 * mock `localStorage` (`ThemeStorageLike`) dan root `<html>` (`ThemeRootLike`)
 * yang meniru urutan operasi yang dijalankan hook saat mount/toggle/remount.
 */
import { expect, test } from "bun:test";
import {
  applyTheme,
  getStoredTheme,
  nextTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
  type ThemeRootLike,
  type ThemeStorageLike,
} from "../use-theme";

function makeStorage(initial: Record<string, string> = {}): ThemeStorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

interface MockRoot extends ThemeRootLike {
  dark: boolean;
}

function makeRoot(): MockRoot {
  const root: MockRoot = {
    dark: false,
    classList: {
      add: (name) => {
        if (name === "dark") root.dark = true;
      },
      remove: (name) => {
        if (name === "dark") root.dark = false;
      },
      toggle: (name, force) => {
        if (name === "dark") root.dark = force ?? !root.dark;
      },
    },
  };
  return root;
}

test("22.2 (8.2): toggle mengubah tema saat ini + disimpan", () => {
  const storage = makeStorage();
  const root = makeRoot();

  // Simulasi mount pertama: tanpa preferensi & sistem light -> light.
  let theme = resolveInitialTheme(storage.getItem(THEME_STORAGE_KEY), () => false);
  applyTheme(root, theme);
  storage.setItem(THEME_STORAGE_KEY, theme);
  expect(theme).toBe("light");
  expect(root.dark).toBe(false);

  // Toggle -> dark, class `dark` terpasang, preferensi tersimpan (8.2).
  theme = nextTheme(theme);
  applyTheme(root, theme);
  storage.setItem(THEME_STORAGE_KEY, theme);
  expect(theme).toBe("dark");
  expect(root.dark).toBe(true);
  expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");

  // Toggle lagi -> kembali light.
  theme = nextTheme(theme);
  applyTheme(root, theme);
  expect(theme).toBe("light");
  expect(root.dark).toBe(false);
});

test("22.2 (8.6): remount dengan preferensi tersimpan menerapkan dark otomatis", () => {
  // Sesi sebelumnya mengaktifkan dark mode -> tersimpan di localStorage.
  const storage = makeStorage({ [THEME_STORAGE_KEY]: "dark" });
  const root = makeRoot();

  // Simulasi mount ulang: tema awal dibaca dari preferensi tersimpan (8.6).
  const theme = resolveInitialTheme(storage.getItem(THEME_STORAGE_KEY), () => false);
  applyTheme(root, theme);
  expect(theme).toBe("dark");
  expect(root.dark).toBe(true);
});

test("22.2: tanpa preferensi -> mengikuti preferensi sistem", () => {
  expect(resolveInitialTheme(null, () => true)).toBe("dark");
  expect(resolveInitialTheme(null, () => false)).toBe("light");
  // Preferensi tersimpan lebih diutamakan daripada preferensi sistem.
  expect(resolveInitialTheme("light", () => true)).toBe("light");
  expect(resolveInitialTheme("dark", () => false)).toBe("dark");
});

test("22.2: getStoredTheme hanya mengenali nilai valid", () => {
  expect(getStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
  expect(getStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: "light" }))).toBe("light");
  expect(getStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: "bogus" }))).toBeNull();
  expect(getStoredTheme(makeStorage())).toBeNull();
});
