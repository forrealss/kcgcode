/**
 * Muat data `GET` dari API sebagai `Load<T>` (lib/load-state.ts) — pola
 * "memuat -> gagal / siap" yang sebelumnya ditulis ulang di tiap komponen.
 *
 * - Lewat `apiFetch`: 401 `AUTH_REQUIRED` memasang lock screen.
 * - Respons usang (path sudah berganti / unmount) dibuang.
 * - `path` null = jeda: tidak memuat, state terakhir dipertahankan (mis.
 *   isi dialog tetap tampil selama animasi tutup); permintaan yang sedang
 *   berjalan dibatalkan -> `idle`.
 * - `reload()` memuat ulang di latar: data lama tetap tampil sampai data
 *   baru tiba (tanpa kembali ke `loading`).
 * - `mutate()` mengubah data siap secara lokal (mis. setelah rename/hapus).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, errorText } from "@/lib/api";
import type { IdleLoad, Load } from "@/lib/load-state";

export interface ApiQueryOptions<T> {
  /** Ubah respons jadi data; default `res.json()`. */
  select?: (res: Response) => Promise<T>;
  /** Pesan bila error bukan `ApiError` (lihat `errorText`). */
  errorMessage: string;
}

export type ApiQuery<S, T> = [
  state: S,
  reload: () => void,
  mutate: (update: (data: T) => T) => void,
];

export function useApiQuery<T>(path: string, options: ApiQueryOptions<T>): ApiQuery<Load<T>, T>;
export function useApiQuery<T>(
  path: string | null,
  options: ApiQueryOptions<T>,
): ApiQuery<IdleLoad<T>, T>;
export function useApiQuery<T>(
  path: string | null,
  { select, errorMessage }: ApiQueryOptions<T>,
): ApiQuery<IdleLoad<T>, T> {
  const [state, setState] = useState<IdleLoad<T>>(
    path === null ? { phase: "idle" } : { phase: "loading" },
  );
  /** Naik tiap `reload()` — memicu efek muat tanpa reset ke `loading`. */
  const [nonce, setNonce] = useState(0);
  // Ref agar `select`/pesan inline pemanggil tidak memicu fetch ulang.
  const selectRef = useRef(select);
  selectRef.current = select;
  const errorRef = useRef(errorMessage);
  errorRef.current = errorMessage;
  /** Path yang terakhir dimuat — beda path = mulai dari `loading`. */
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    // `nonce` hanya pemicu reload.
    void nonce;
    if (path === null) {
      // Dibuka lagi nanti -> mulai dari `loading` (bukan muat ulang di latar).
      loadedPath.current = null;
      setState((s) => (s.phase === "loading" ? { phase: "idle" } : s));
      return;
    }
    let stale = false;
    if (loadedPath.current !== path) {
      loadedPath.current = path;
      setState({ phase: "loading" });
    }
    apiFetch(path)
      .then((res) => (selectRef.current ? selectRef.current(res) : (res.json() as Promise<T>)))
      .then(
        (data) => {
          if (!stale) setState({ phase: "ready", data });
        },
        (e: unknown) => {
          if (!stale) setState({ phase: "error", message: errorText(e, errorRef.current) });
        },
      );
    return () => {
      stale = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const mutate = useCallback(
    (update: (data: T) => T) =>
      setState((s) => (s.phase === "ready" ? { phase: "ready", data: update(s.data) } : s)),
    [],
  );

  return [state, reload, mutate];
}
