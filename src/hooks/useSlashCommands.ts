/**
 * Autocomplete slash command di composer: mengetik `/` di awal input membuka
 * daftar command agent (bawaan, kustom, skill) — seperti Claude Code CLI.
 *
 * - Daftar dimuat MALAS saat `/` pertama diketik (Claude Code mungkin perlu
 *   menjalankan proses `claude` sementara untuk daftarnya), lalu dipakai
 *   ulang selama endpoint sama. Gagal -> dicoba lagi saat `/` diketik ulang.
 * - Penyaringan & penyisipan teks memakai helper murni `lib/slash-commands`.
 * - API sengaja sama dengan `useFileMention` (onInputChange, handleKeyDown,
 *   pick, close, opsi `onPick`) agar pemasangannya di composer seragam.
 * - Fetch default `apiFetch`: sesi habis (401) memasang lock screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useListNavigation } from "@/hooks/useListNavigation";
import { apiFetch } from "@/lib/api";
import {
  type ActiveSlash,
  activeSlashCommand,
  applySlashCommand,
  commandNames,
  filterCommands,
} from "@/lib/slash-commands";
import type { SlashCommandInfo } from "@/types";

export interface UseSlashCommandsResult {
  /** Dropdown tampil (memuat, error, atau ada command yang cocok). */
  open: boolean;
  /** Command yang cocok dengan query aktif. */
  matches: SlashCommandInfo[];
  /** Indeks command yang disorot (navigasi panah). */
  highlighted: number;
  loading: boolean;
  error: string | null;
  /** Nama + alias command yang dikenal (sorot `/nama` di composer). */
  known: ReadonlySet<string>;
  /** Dipanggil dari onChange textarea. */
  onInputChange(text: string, caret: number): void;
  /** Pilih command ke-i -> teks input baru (`/nama `), atau null. */
  pick(index: number): string | null;
  /** Navigasi keyboard; true bila event ditangani (blok default). */
  handleKeyDown(e: { key: string; preventDefault(): void }): boolean;
  close(): void;
}

type FetchFn = (path: string) => Promise<Response>;

export interface UseSlashCommandsOptions {
  /** Hasil pilihan keyboard (Enter/Tab) — teks input baru. */
  onPick?: (next: string) => void;
  fetchFn?: FetchFn;
}

export function useSlashCommands(
  /** `GET` daftar command, mis. `/api/projects/:id/commands?agent=…`; null = nonaktif. */
  endpoint: string | null,
  { onPick, fetchFn = apiFetch }: UseSlashCommandsOptions = {},
): UseSlashCommandsResult {
  const [active, setActive] = useState<ActiveSlash | null>(null);
  const [commands, setCommands] = useState<SlashCommandInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTextRef = useRef("");
  /** Query aktif terakhir — sorotan kembali ke baris pertama saat berubah. */
  const queryRef = useRef<string | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Endpoint berganti (Project / agent lain) -> daftar lama tidak berlaku.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset hanya saat endpoint berubah
  useEffect(() => {
    setCommands(null);
    setError(null);
  }, [endpoint]);

  // Muat daftar begitu token `/` aktif dan daftar belum ada.
  const wantList = active !== null && endpoint !== null && commands === null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetchFn stabil dari pemanggil
  useEffect(() => {
    if (!wantList || endpoint === null) return;
    let stale = false;
    setLoading(true);
    setError(null);
    fetchFn(endpoint)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { commands?: SlashCommandInfo[] };
        if (!stale) setCommands(Array.isArray(body.commands) ? body.commands : []);
      })
      .catch(() => {
        if (!stale) setError("Failed to load commands");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [wantList, endpoint]);

  const matches = useMemo(
    () => (active && commands ? filterCommands(commands, active.query) : []),
    [active, commands],
  );
  const known = useMemo(() => commandNames(commands ?? []), [commands]);
  // `/usr/bin…` tanpa command yang cocok tidak memunculkan dropdown kosong.
  const open = active !== null && (loading || error !== null || matches.length > 0);

  const nav = useListNavigation({
    count: matches.length,
    active: open,
    onSelect: (index) => {
      const next = pick(index);
      if (next !== null) onPickRef.current?.(next);
      return next !== null;
    },
    onClose: () => close(),
  });
  const { resetHighlight } = nav;

  const close = useCallback(() => {
    queryRef.current = null;
    setActive(null);
    resetHighlight();
    // Error dibuang agar `/` berikutnya mencoba memuat ulang.
    setError(null);
  }, [resetHighlight]);

  const onInputChange = useCallback(
    (text: string, caret: number) => {
      lastTextRef.current = text;
      const next = endpoint === null ? null : activeSlashCommand(text, caret);
      if (next === null) {
        close();
        return;
      }
      if (queryRef.current !== next.query) {
        queryRef.current = next.query;
        resetHighlight();
      }
      setActive(next);
    },
    [endpoint, close, resetHighlight],
  );

  const pick = useCallback(
    (index: number): string | null => {
      const c = matches[index];
      if (!c) return null;
      const next = applySlashCommand(lastTextRef.current, c.name);
      close();
      return next;
    },
    [matches, close],
  );

  return {
    open,
    matches,
    highlighted: nav.highlighted,
    loading,
    error,
    known,
    onInputChange,
    pick,
    handleKeyDown: nav.handleKeyDown,
    close,
  };
}
