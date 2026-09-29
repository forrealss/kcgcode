/**
 * Store global kunci aplikasi (FE): status dari server + pemicu lock screen.
 *
 * - `refreshAuth()` memuat `GET /api/auth/status` (publik).
 * - 401 `AUTH_REQUIRED` dari API mana pun -> `markLocked()` (lock screen
 *   muncul tanpa reload; data di belakangnya tidak lagi bisa dimuat).
 * - `lockNow()` = tombol Lock: hapus sesi di server lalu tampilkan lock screen.
 * - Kunci otomatis ditegakkan SERVER (sesi idle kedaluwarsa); klien hanya
 *   mengetahuinya lebih cepat lewat timer idle lokal + heartbeat.
 */
import { useSyncExternalStore } from "react";
import { apiFetch, setAuthRequiredHandler } from "@/lib/api";
import type { AuthStatus } from "@/server/services/auth";

export type AuthState =
  | { phase: "loading" }
  /** Server tak terjangkau saat memuat status pertama kali. */
  | { phase: "error" }
  | { phase: "ready"; status: AuthStatus };

let state: AuthState = { phase: "loading" };
const listeners = new Set<() => void>();

function set(next: AuthState): void {
  state = next;
  for (const l of listeners) l();
}

export async function refreshAuth(): Promise<AuthStatus | null> {
  try {
    const res = await fetch("/api/auth/status", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const status = (await res.json()) as AuthStatus;
    // Status sama persis -> jangan picu render ulang (heartbeat berkala).
    if (state.phase !== "ready" || JSON.stringify(state.status) !== JSON.stringify(status)) {
      set({ phase: "ready", status });
    }
    return status;
  } catch {
    if (state.phase === "loading") set({ phase: "error" });
    return null;
  }
}

/** Server menolak sesi (401) -> kunci UI segera, lalu sinkronkan status. */
export function markLocked(): void {
  if (state.phase === "ready" && state.status.protected && state.status.authenticated) {
    set({ phase: "ready", status: { ...state.status, authenticated: false } });
  }
  void refreshAuth();
}

/** Tombol Lock: akhiri sesi perangkat ini. */
export async function lockNow(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Sesi mungkin sudah tidak berlaku — tetap tampilkan lock screen.
  }
  markLocked();
}

setAuthRequiredHandler(markLocked);

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(): AuthState {
  return state;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Label jenis kunci untuk UI. */
export function lockLabel(kind: "pin" | "password"): string {
  return kind === "pin" ? "PIN" : "password";
}

/** Inisial nickname untuk avatar pengganti ("Irsyad Ibad" -> "II"). */
export function initialsOf(nickname: string | null): string {
  if (!nickname) return "";
  const words = nickname.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return letters
    .map((w) => [...(w ?? "")][0] ?? "")
    .join("")
    .toUpperCase();
}
