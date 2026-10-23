/**
 * Status Remote access (`GET /api/tunnel`) bersama — satu poller untuk semua
 * pemakai (pembungkus Remote access & panel penyedia bawaan), bukan satu
 * per komponen.
 *
 * - Poll 5 dtk; 1,5 dtk bila `fast(data)` salah satu pemakai bernilai true
 *   (mis. pairing / tunnel sedang menyambung).
 * - Permintaan yang sedang berjalan dipakai bersama (`refresh()` beruntun
 *   tidak menggandakan fetch).
 * - Pemakai terakhir lepas -> poll berhenti & data dibuang (masuk lagi =
 *   mulai dari memuat, seperti sebelumnya).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Provider } from "@/components/settings/RemoteAccessGroup/ProviderPicker";
import { apiFetch } from "@/lib/api";
import type { TunnelStatus } from "@/server/services/tunnel";
import type { LhrStatus } from "@/server/services/tunnel-lhr";

/** Body `GET /api/tunnel`. */
export interface TunnelOverview {
  provider?: Provider;
  tunnel?: TunnelStatus;
  lhr?: LhrStatus;
}

const FAST_MS = 1500;
const SLOW_MS = 5000;

let snapshot: TunnelOverview | null = null;
const listeners = new Set<() => void>();
/** Pemakai aktif -> apakah meminta poll cepat. */
const subscribers = new Map<symbol, boolean>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<TunnelOverview | null> | null = null;
/** Naik saat semua pemakai lepas — respons lama dibuang. */
let generation = 0;

function setSnapshot(next: TunnelOverview | null): void {
  snapshot = next;
  for (const l of listeners) l();
}

/** Muat ulang sekarang; `null` bila gagal (data lama dipertahankan). */
export function refreshTunnelStatus(): Promise<TunnelOverview | null> {
  if (inFlight) return inFlight;
  const gen = generation;
  const req = apiFetch("/api/tunnel")
    .then((res) => res.json() as Promise<TunnelOverview>)
    .then(
      (body) => {
        if (gen === generation) setSnapshot(body);
        return body;
      },
      () => null,
    )
    .finally(() => {
      if (inFlight === req) inFlight = null;
    });
  inFlight = req;
  return req;
}

/** Terapkan status tunnel dari balasan aksi (connect, stop, …) tanpa fetch ulang. */
export function setTunnelStatus(tunnel: TunnelStatus): void {
  setSnapshot({ ...snapshot, tunnel });
}

function reschedule(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (subscribers.size === 0) return;
  const fast = [...subscribers.values()].some(Boolean);
  timer = setInterval(() => void refreshTunnelStatus(), fast ? FAST_MS : SLOW_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface TunnelStatusHandle {
  data: TunnelOverview | null;
  refresh: () => Promise<TunnelOverview | null>;
  setTunnel: (tunnel: TunnelStatus) => void;
}

export function useTunnelStatus({
  fast,
}: {
  /** Minta poll cepat berdasarkan data terbaru. */
  fast?: (data: TunnelOverview | null) => boolean;
} = {}): TunnelStatusHandle {
  const data = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
  const isFast = fast?.(data) ?? false;
  const [id] = useState(() => Symbol("tunnel-status"));
  useEffect(() => {
    subscribers.set(id, false);
    return () => {
      subscribers.delete(id);
      if (subscribers.size === 0) {
        generation += 1;
        inFlight = null;
        snapshot = null;
      }
      reschedule();
    };
  }, [id]);
  // Mode poll berganti -> muat sekarang lalu jadwal ulang (seperti dulu).
  useEffect(() => {
    subscribers.set(id, isFast);
    void refreshTunnelStatus();
    reschedule();
  }, [id, isFast]);
  return { data, refresh: refreshTunnelStatus, setTunnel: setTunnelStatus };
}
