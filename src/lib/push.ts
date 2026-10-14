/**
 * Web Push di sisi browser — status dukungan, berlangganan, berhenti, dan
 * sinkron ulang langganan ke server tiap app dibuka.
 *
 * Kapan push TIDAK bisa dipakai:
 * - Bukan secure context (HTTP ke IP LAN): `PushManager` tidak tersedia.
 * - iOS/iPadOS di tab Safari: push hanya untuk app yang sudah di-Add to
 *   Home Screen (iOS 16.4+).
 * - Alamat localhost.run (`*.lhr.life`): berganti tiap sambung ulang, jadi
 *   service worker & langganannya ikut basi.
 *
 * Endpoint langganan perangkat ini disimpan di memori (`deviceEndpoint`)
 * untuk `notify_ack` — server melewatkan push ke perangkat yang sedang
 * menampilkan notifikasinya di layar.
 */
import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api";
import { isEphemeralHost, isIOS, isStandalone } from "@/lib/pwa";

export type PushSupport =
  | "supported"
  /** HTTP biasa (bukan HTTPS / localhost). */
  | "insecure"
  /** iOS di tab Safari — perlu Add to Home Screen dulu. */
  | "ios-install"
  /** Alamat localhost.run yang berganti-ganti. */
  | "ephemeral"
  /** Browser tanpa Push API / Notification API. */
  | "unsupported";

export interface PushEnv {
  secure: boolean;
  hasPush: boolean;
  hostname: string;
  ios: boolean;
  standalone: boolean;
}

/** Logika murni (teruji) — lihat `pushSupport()` untuk nilai nyata. */
export function resolvePushSupport(env: PushEnv): PushSupport {
  if (isEphemeralHost(env.hostname)) return "ephemeral";
  if (!env.secure) return "insecure";
  if (env.ios && !env.standalone) return "ios-install";
  if (!env.hasPush) return "unsupported";
  return "supported";
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  return resolvePushSupport({
    secure: window.isSecureContext,
    hasPush: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    hostname: window.location.hostname,
    ios: isIOS(navigator.userAgent, navigator.maxTouchPoints),
    standalone: isStandalone(),
  });
}

/** Ubah kunci VAPID base64url ke byte untuk `applicationServerKey`. */
export function vapidKeyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- State perangkat ini (dibagikan ke komponen lewat useSyncExternalStore) ----

export interface PushDeviceState {
  /** Endpoint langganan perangkat ini (null = tidak berlangganan). */
  endpoint: string | null;
  /** Id perangkat di server (hash endpoint) — menandai "This device". */
  deviceId: string | null;
}

let state: PushDeviceState = { endpoint: null, deviceId: null };
const listeners = new Set<() => void>();

function setState(next: PushDeviceState): void {
  state = next;
  for (const l of listeners) l();
}

export function usePushDevice(): PushDeviceState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Endpoint push perangkat ini, untuk `notify_ack`. */
export function deviceEndpoint(): string | null {
  return state.endpoint;
}

/**
 * Registrasi service worker untuk push. Produksi memakai `/sw.js` yang sudah
 * didaftarkan `frontend.tsx`; saat `bun dev` (HMR) SW tidak didaftarkan, jadi
 * di sini dipasang varian tanpa cache (`/sw.js?dev=1`) khusus push.
 */
async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  const dev = Boolean(import.meta.hot);
  await navigator.serviceWorker.register(dev ? "/sw.js?dev=1" : "/sw.js");
  return navigator.serviceWorker.ready;
}

/** Daftarkan langganan ke server. `false` = server tidak lagi mengenalnya (`refreshOnly`). */
async function register(sub: PushSubscription, refreshOnly = false): Promise<boolean> {
  const json = sub.toJSON();
  const res = await apiFetch("/api/push/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, refreshOnly }),
  });
  const { device } = (await res.json()) as { device: { id: string } | null };
  setState(
    device ? { endpoint: sub.endpoint, deviceId: device.id } : { endpoint: null, deviceId: null },
  );
  return device !== null;
}

/**
 * Nyalakan notifikasi di perangkat ini: minta izin (harus dari klik user),
 * berlangganan dengan kunci VAPID server, lalu daftarkan ke server.
 * Hasil `"denied"` = user/browser menolak izin.
 */
export async function enablePush(): Promise<"enabled" | "denied"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await registration();
  const res = await apiFetch("/api/push/vapid-key");
  const { publicKey } = (await res.json()) as { publicKey: string };
  let sub = await reg.pushManager.getSubscription();
  // Langganan lama dengan kunci server berbeda (DB di-reset) tidak akan
  // pernah menerima pesan — ganti.
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKeyBytes(publicKey),
  });
  await register(sub);
  return "enabled";
}

function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options.applicationServerKey;
  if (!key) return true;
  const a = new Uint8Array(key);
  const b = vapidKeyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Matikan notifikasi di perangkat ini (lepas langganan browser + server). */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  const id = state.deviceId;
  setState({ endpoint: null, deviceId: null });
  if (id) await apiFetch(`/api/push/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
  await sub?.unsubscribe();
}

/**
 * Dipanggil sekali setelah app terbuka & tidak terkunci: bila perangkat ini
 * berlangganan, segarkan datanya di server dan isi endpoint untuk
 * `notify_ack`. Perangkat yang sudah dihapus di server (dari Settings
 * perangkat lain atau `reset-lock`) dilepas juga di browser agar status
 * di Settings jujur — tidak didaftarkan ulang diam-diam.
 */
export async function syncPush(): Promise<void> {
  if (pushSupport() !== "supported" || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub && !(await register(sub, true))) await sub.unsubscribe();
  } catch {
    // Gagal sinkron tidak menghalangi app; dicoba lagi saat dibuka berikutnya.
  }
}

/** Status langganan perangkat ini untuk Settings (tanpa mendaftar ulang). */
export async function hasLocalSubscription(): Promise<boolean> {
  if (pushSupport() !== "supported") return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return Boolean(await reg?.pushManager.getSubscription());
}
