/**
 * Konteks kerja Session untuk panel kanan: perubahan file, cabang git, dan
 * task list agent (`GET /api/sessions/:id/context`).
 *
 * Polling, bukan WebSocket: sumbernya (git + `todowrite`) tidak memancarkan
 * event ke KCG Code, dan panel hanya perlu "cukup baru". Supaya tidak memboros
 * request:
 * - Hanya di-poll saat panel TERBUKA (`enabled`).
 * - Saat model sedang bekerja (`busy`) interval dipercepat — di situlah file &
 *   task list berubah; selainnya lambat.
 * - Tab di latar belakang -> poll dihentikan (`visibilitychange`), lalu
 *   langsung menyegarkan begitu tab aktif kembali.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { SessionContext } from "@/types";

/** Interval poll saat model bekerja vs idle (ms). */
const ACTIVE_MS = 2500;
const IDLE_MS = 12000;

export interface UseSessionContextResult {
  context: SessionContext | null;
  /** Fetch pertama belum selesai (panel menampilkan skeleton). */
  loading: boolean;
  /** Muat ulang sekarang (mis. setelah aksi pengguna). */
  refresh: () => void;
}

export function useSessionContext(
  sessionId: string,
  /** Panel terbuka — data hanya diambil saat dibutuhkan. */
  enabled: boolean,
  /** Model sedang merespon: konteks berubah cepat, poll dipercepat. */
  busy: boolean,
): UseSessionContextResult {
  const [context, setContext] = useState<SessionContext | null>(null);
  const [loading, setLoading] = useState(false);
  /** Ada data yang bisa ditampilkan — skeleton hanya untuk fetch pertama. */
  const hasData = useRef(false);
  /** Request terakhir yang masih relevan (hindari balasan basi saling timpa). */
  const runId = useRef(0);

  const load = useCallback(async () => {
    const id = ++runId.current;
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/context`);
      const body = (await res.json()) as { context?: SessionContext };
      if (id !== runId.current || !body.context) return;
      hasData.current = true;
      setContext(body.context);
    } catch {
      // Panel ini bukan alur utama: kegagalan jaringan cukup diabaikan,
      // poll berikutnya mencoba lagi. Data terakhir tetap ditampilkan.
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, [sessionId]);

  const refresh = useCallback(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  // Session berganti -> buang data lama agar panel tidak menampilkan konteks
  // Session sebelumnya. Efeknya hanya me-reset (tidak membaca nilai apa pun),
  // jadi `sessionId` sengaja dipakai sebagai PEMICU, bukan dependency nilai.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sessionId` adalah pemicu reset
  useEffect(() => {
    hasData.current = false;
    setContext(null);
  }, [sessionId]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(!hasData.current);
    void load();

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => void load(), busy ? ACTIVE_MS : IDLE_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, busy, load]);

  return { context, loading, refresh };
}
