/**
 * Klien passkey (WebAuthn) — membungkus `@simplewebauthn/browser` + API
 * `/api/auth/passkeys/*` agar Settings & lock screen memakai alur yang sama.
 *
 * Pembatalan oleh pengguna (menutup dialog sistem) bukan error: dikembalikan
 * sebagai `{ ok: false, cancelled: true }` supaya UI tidak menampilkan pesan
 * merah untuk tindakan yang disengaja.
 */
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { ApiError, apiFetch } from "@/lib/api";
import type { PasskeyAvailability, PasskeyInfo } from "@/server/services/auth-passkeys";

export type { PasskeyAvailability, PasskeyInfo };

export type PasskeyResult<T> =
  | { ok: true; data: T }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string; code?: string };

/** Browser ini bisa memakai passkey (API WebAuthn + secure context). */
export function passkeysSupportedHere(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext && browserSupportsWebAuthn();
}

/**
 * Error dari `navigator.credentials` -> pesan ramah. `NotAllowedError` =
 * dibatalkan / timeout oleh pengguna (diperlakukan sebagai batal).
 */
export function describeWebAuthnError(e: unknown): PasskeyResult<never> {
  if (e instanceof ApiError)
    return { ok: false, cancelled: false, message: e.message, code: e.code };
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return { ok: false, cancelled: true };
  if (name === "InvalidStateError") {
    return { ok: false, cancelled: false, message: "This device already has a passkey here." };
  }
  if (name === "SecurityError") {
    return {
      ok: false,
      cancelled: false,
      message: "Passkeys aren't allowed on this address. Use https or localhost.",
    };
  }
  return { ok: false, cancelled: false, message: "Something went wrong with the passkey." };
}

export async function getPasskeyAvailability(): Promise<PasskeyAvailability> {
  const res = await apiFetch("/api/auth/passkeys/availability");
  return (await res.json()) as PasskeyAvailability;
}

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const res = await apiFetch("/api/auth/passkeys");
  return ((await res.json()) as { passkeys: PasskeyInfo[] }).passkeys;
}

/** Daftarkan passkey baru; `current` = PIN/password saat ini (konfirmasi). */
export async function addPasskey(current: string): Promise<PasskeyResult<PasskeyInfo>> {
  try {
    const optRes = await apiFetch("/api/auth/passkeys/register/options", {
      method: "POST",
      body: JSON.stringify({ current }),
    });
    const { challengeId, options } = (await optRes.json()) as {
      challengeId: string;
      options: Parameters<typeof startRegistration>[0]["optionsJSON"];
    };
    const response = await startRegistration({ optionsJSON: options });
    const res = await apiFetch("/api/auth/passkeys/register", {
      method: "POST",
      body: JSON.stringify({ challengeId, response }),
    });
    return { ok: true, data: ((await res.json()) as { passkey: PasskeyInfo }).passkey };
  } catch (e) {
    return describeWebAuthnError(e);
  }
}

/** Buka kunci dengan passkey. Sukses = cookie sesi sudah diset server. */
export async function unlockWithPasskey(): Promise<PasskeyResult<null>> {
  try {
    const optRes = await apiFetch("/api/auth/passkeys/login/options", { method: "POST" });
    const { challengeId, options } = (await optRes.json()) as {
      challengeId: string;
      options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
    };
    const response = await startAuthentication({ optionsJSON: options });
    await apiFetch("/api/auth/passkeys/login", {
      method: "POST",
      body: JSON.stringify({ challengeId, response }),
    });
    return { ok: true, data: null };
  } catch (e) {
    return describeWebAuthnError(e);
  }
}

export async function renamePasskey(id: string, name: string): Promise<PasskeyInfo> {
  const res = await apiFetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { passkey: PasskeyInfo }).passkey;
}

export async function removePasskey(id: string): Promise<void> {
  await apiFetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
}
