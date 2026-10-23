/**
 * Log yang diambil bertahap dari endpoint `?from=<offset>` (balasan
 * `{ lines, next }`) — log frpc / localhost.run dan log dev server Preview.
 *
 * Dua cara memicu pengambilan:
 * - `pollMs`: polling berkala selama `enabled`;
 * - `offset`: ambil bila server melaporkan offset di atas yang sudah dibaca
 *   (mis. dari status yang datang lewat WS / poll lain).
 *
 * `endpoint` atau `resetKey` berganti (mis. dev server di-restart = buffer
 * log baru) -> log dikosongkan dan dibaca dari awal; respons lama dibuang.
 * `enabled` false hanya menjeda (log & offset dipertahankan).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { apiFetch } from "@/lib/api";

export interface UseIncrementalLogOptions {
  enabled?: boolean;
  /** Interval polling (ms); tanpa ini hanya `offset` yang memicu. */
  pollMs?: number;
  /** Offset log terbaru di server — ambil bila melewati yang sudah dibaca. */
  offset?: number;
  /** Pemicu reset selain `endpoint`. */
  resetKey?: unknown;
  /** Batas baris yang disimpan (yang lama dibuang). */
  max?: number;
}

export function useIncrementalLog(
  endpoint: string,
  { enabled = true, pollMs, offset, resetKey, max = 300 }: UseIncrementalLogOptions = {},
): string[] {
  const [lines, setLines] = useState<string[]>([]);
  const from = useRef(0);
  /** Naik tiap reset — respons generasi lama dibuang. */
  const generation = useRef(0);
  const inFlight = useRef(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `endpoint`/`resetKey` sengaja jadi pemicu reset
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    from.current = 0;
    setLines([]);
  }, [endpoint, resetKey]);

  const fetchMore = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const gen = generation.current;
    let ok = false;
    try {
      const res = await apiFetch(`${endpoint}?from=${from.current}`);
      const body = (await res.json()) as { lines: string[]; next: number };
      if (gen !== generation.current) return;
      // Hanya kejar lagi bila offset benar-benar maju (hindari loop).
      ok = body.next > from.current;
      from.current = body.next;
      if (body.lines.length > 0) setLines((prev) => [...prev, ...body.lines].slice(-max));
    } catch {
      /* coba lagi di pemicu berikutnya */
    } finally {
      if (gen === generation.current) inFlight.current = false;
    }
    // Offset naik lagi selama mengambil -> kejar sekarang.
    const latest = offsetRef.current;
    if (ok && latest !== undefined && latest > from.current) void fetchMore();
  }, [endpoint, max]);

  usePolling(fetchMore, pollMs ?? 0, { enabled: enabled && pollMs !== undefined });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetKey` memicu ambil ulang setelah reset log
  useEffect(() => {
    if (!enabled || offset === undefined || offset <= from.current) return;
    void fetchMore();
  }, [enabled, offset, fetchMore, resetKey]);

  return lines;
}
