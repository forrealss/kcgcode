/**
 * Deteksi & penyelesaian referensi `@file` pada input composer (meniru
 * perilaku `@` di opencode TUI).
 *
 * Logika murni yang dapat diuji tanpa DOM:
 * - `activeMention(text, caret)`: token `@query` yang sedang diketik pada
 *   posisi kursor (bila ada), beserta rentang [start, end) di string input.
 * - `applyMention(text, range, path)`: ganti token `@query` dengan teks
 *   `@path` saat satu saran dipilih.
 *
 * Hook `useFileMention` mengelola state dropdown + fetch `/files?q=`
 * dengan debounce 150 ms; server mencari via index milik opencode. Fetch
 * default `apiFetch`: sesi habis (401) memasang lock screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useListNavigation } from "@/hooks/useListNavigation";
import { apiFetch } from "@/lib/api";

export interface ActiveMention {
  /** Teks query setelah `@` (tanpa simbol `@`). */
  query: string;
  /** Posisi awal token (indeks karakter `@`). */
  start: number;
  /** Posisi akhir token (satu melewati karakter terakhir query). */
  end: number;
}

/** Apakah karakter dipisah kata (token `@` berhenti di sini). */
function isBoundary(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return /[\s]/.test(ch) || "()[]{}<>,'\"`".includes(ch);
}

/**
 * Token `@query` aktif pada posisi kursor — hanya bila kursor berada di
 * dalam/di akhir token dan token tersebut dimulai dengan `@` yang berdiri
 * sendiri (bukan bagian dari kata lain, mis. email).
 */
export function activeMention(text: string, caret: number): ActiveMention | null {
  if (caret < 0 || caret > text.length) return null;
  // Cari `@` terakhir sebelum kursor tanpa spasi di antaranya.
  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      at = i;
      break;
    }
    if (isBoundary(ch)) return null;
  }
  if (at < 0) return null;
  // `@` harus berdiri sendiri (awal teks atau dipisah karakter non-kata).
  const before = text[at - 1];
  if (before !== undefined && !isBoundary(before)) return null;
  const query = text.slice(at + 1, caret);
  // Query tak boleh memuat pemisah kata (kursor sudah dijaga di atas, tapi
  // token yang tersisa bisa saja panjang — batasi agar fetch masuk akal).
  if (query.length > 200) return null;
  return { query, start: at, end: caret };
}

/** Ganti token `@query` pada rentang `range` dengan `@<path>`. */
export function applyMention(text: string, range: ActiveMention, path: string): string {
  const replacement = `@${path}`;
  const after = text[range.end];
  // Beri spasi penutup bila karakter setelah token bukan pemisah.
  const suffix = after !== undefined && !isBoundary(after) ? " " : "";
  return text.slice(0, range.start) + replacement + suffix + text.slice(range.end);
}

export interface UseFileMentionResult {
  /** Saran file yang sedang tampil (kosong = dropdown tertutup). */
  suggestions: string[];
  /** Indeks saran yang disorot (navigasi panah). */
  highlighted: number;
  /** Range token `@` aktif saat ini; null bila tidak ada. */
  mention: ActiveMention | null;
  loading: boolean;
  error: string | null;
  /** Dipanggil dari onChange textarea. */
  onInputChange(text: string, caret: number): void;
  /** Pilih saran pada indeks tertentu -> hasil teks baru via `applyMention`. */
  pick(index: number): string | null;
  /** Navigasi keyboard; return true bila event ditangani (blok default). */
  handleKeyDown(e: { key: string; preventDefault(): void }): boolean;
  /** Tutup dropdown (mis. saat blur). */
  close(): void;
}

export interface UseFileMentionOptions {
  /** Endpoint pencarian file, mis. `/api/sessions/:id/files`. */
  endpoint: string;
  /** Jeda debounce fetch (default 150 ms). */
  debounceMs?: number;
  /** Batas saran yang ditampilkan. */
  limit?: number;
  /**
   * Dipanggil saat saran dipilih via keyboard (Enter/Tab) — menerima teks
   * input baru hasil substitusi `@path` (hook tidak memegang state textarea).
   */
  onPick?: (next: string) => void;
}

type FetchFn = (path: string) => Promise<Response>;

export function useFileMention(
  opts: UseFileMentionOptions,
  fetchFn: FetchFn = apiFetch,
): UseFileMentionResult {
  const { endpoint, debounceMs = 150, limit = 8, onPick } = opts;
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTextRef = useRef("");
  const lastCaretRef = useRef(0);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const nav = useListNavigation({
    count: suggestions.length,
    active: mention !== null && suggestions.length > 0,
    onSelect: (index) => {
      const next = pick(index);
      // Teruskan teks baru ke pemanggil — tanpa ini hasil pilihan keyboard
      // terbuang (bug: Enter tidak menyisipkan file).
      if (next !== null) onPickRef.current?.(next);
      return next !== null;
    },
    onClose: () => close(),
  });
  const { resetHighlight } = nav;

  const close = useCallback(() => {
    setSuggestions([]);
    setMention(null);
    resetHighlight();
    setError(null);
  }, [resetHighlight]);

  // Fetch saran (debounced) setiap mention berubah. fetchFn/endpoint tidak
  // masuk dependency (stabil dari pemanggil; efek cukup pada perubahan token).
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependensi eksternal sengaja dipatok
  useEffect(() => {
    if (!mention) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchFn(`${endpoint}?q=${encodeURIComponent(mention.query)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = (await res.json()) as { files?: unknown };
          const files = Array.isArray(body.files)
            ? body.files.filter((f): f is string => typeof f === "string")
            : [];
          setSuggestions(files.slice(0, limit));
          resetHighlight();
        })
        .catch((e) => {
          if ((e as Error).name === "AbortError") return;
          setError("Failed to search files");
          setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mention?.start, mention?.query]);

  const onInputChange = useCallback(
    (text: string, caret: number) => {
      lastTextRef.current = text;
      lastCaretRef.current = caret;
      const m = activeMention(text, caret);
      if (m) {
        setMention(m);
      } else {
        close();
      }
    },
    [close],
  );

  const pick = useCallback(
    (index: number): string | null => {
      if (!mention || suggestions[index] === undefined) return null;
      const next = applyMention(lastTextRef.current, mention, suggestions[index] as string);
      close();
      return next;
    },
    [mention, suggestions, close],
  );

  return {
    suggestions,
    highlighted: nav.highlighted,
    mention,
    loading,
    error,
    onInputChange,
    pick,
    handleKeyDown: nav.handleKeyDown,
    close,
  };
}
