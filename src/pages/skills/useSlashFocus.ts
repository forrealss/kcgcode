/** Pintasan `/` halaman Skills: fokus ke kolom cari. */
import { type RefObject, useEffect } from "react";

/** Pintasan `/` memfokuskan kolom cari (kecuali sedang mengetik di input lain). */
export function useSlashFocus(inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputRef]);
}
