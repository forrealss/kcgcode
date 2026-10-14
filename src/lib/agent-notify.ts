/**
 * Notifikasi agent di dalam app (pesan WS `notify`, lihat
 * `server/services/notifications.ts`):
 *
 * - Tab terlihat: putar `notification.ogg`, tampilkan toast (kecuali sedang
 *   membuka Session itu — kartunya sudah tampil di layar), lalu balas
 *   `notify_ack` agar server tidak mengirim Web Push ke perangkat ini.
 * - Tab tersembunyi: tidak ack -> Web Push yang membunyikan perangkat.
 *   Perangkat tanpa langganan push tetap memutar suara (mis. tab latar di
 *   desktop) supaya kabar tidak terlewat.
 *
 * Satu tab bisa punya lebih dari satu koneksi mode daftar (sidebar + daftar
 * Session), jadi notifikasi di-dedupe per id.
 */
import { toast } from "sonner";
import { navigate } from "@/hooks/useRouter";
import { deviceEndpoint } from "@/lib/push";
import type { AgentNotification } from "@/types";
import type { ClientMessage } from "../ws-protocol";

const SOUND_KEY = "kcg-code:notification-sound";
const SOUND_URL = "/sounds/notification.ogg";

/** Suara notifikasi dinyalakan (default: ya). Per perangkat. */
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, "off");
  } catch {
    // Storage diblokir: preferensi hanya berlaku sampai halaman ditutup.
  }
}

let audio: HTMLAudioElement | null = null;

/**
 * Putar suara notifikasi. Browser memblokir audio sebelum ada interaksi
 * user di halaman — kegagalan itu diabaikan (toast tetap tampil).
 */
export function playNotificationSound(): void {
  if (typeof Audio === "undefined") return;
  audio ??= new Audio(SOUND_URL);
  audio.currentTime = 0;
  void audio.play().catch(() => {});
}

const seen = new Set<string>();

export interface NotifyContext {
  visible: boolean;
  pathname: string;
  endpoint: string | null;
  sound: boolean;
}

export interface NotifyPlan {
  sound: boolean;
  toast: boolean;
  /** Endpoint untuk `notify_ack` (null = jangan ack). */
  ack: string | null;
}

/** Keputusan murni (teruji): apa yang dilakukan tab ini untuk satu notifikasi. */
export function planNotify(n: AgentNotification, ctx: NotifyContext): NotifyPlan {
  if (!ctx.visible) {
    // Tak terlihat: push yang bertugas. Tanpa push, suara jadi satu-satunya kabar.
    return { sound: ctx.sound && ctx.endpoint === null, toast: false, ack: null };
  }
  return {
    sound: ctx.sound,
    toast: n.url !== ctx.pathname,
    ack: ctx.endpoint,
  };
}

/** Tangani pesan WS `notify` (dipanggil dari koneksi mode daftar sidebar). */
export function handleAgentNotification(
  n: AgentNotification,
  send: (msg: ClientMessage) => boolean,
): void {
  if (seen.has(n.id)) return;
  seen.add(n.id);
  if (seen.size > 200) seen.delete(seen.values().next().value as string);

  const plan = planNotify(n, {
    visible: document.visibilityState === "visible",
    pathname: window.location.pathname,
    endpoint: deviceEndpoint(),
    sound: soundEnabled(),
  });
  if (plan.ack) send({ type: "notify_ack", id: n.id, endpoint: plan.ack });
  if (plan.sound) playNotificationSound();
  if (plan.toast) {
    const waiting = n.kind === "permission" || n.kind === "question";
    toast(n.title, {
      id: n.sessionId ? `notify-${n.sessionId}` : n.id,
      description: n.body,
      duration: waiting ? 10_000 : 5_000,
      action: { label: "Open", onClick: () => navigate(n.url) },
    });
  }
}
