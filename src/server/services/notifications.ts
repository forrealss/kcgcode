/**
 * Notification_Service — kabar "agent butuh kamu" & "agent selesai".
 *
 * Alur satu notifikasi:
 * 1. Event agent (kartu izin/pertanyaan baru, turn selesai/gagal) dirakit
 *    jadi `AgentNotification` lalu dikirim ke semua tab lewat WebSocket
 *    (`notify`). Tab yang TERLIHAT memutar suara + toast dan membalas
 *    `notify_ack` berisi endpoint push perangkatnya.
 * 2. Setelah jendela ack singkat, Web Push dikirim ke setiap subscription
 *    yang TIDAK membalas — perangkat yang sedang dipakai tidak menerima
 *    notifikasi ganda, sedangkan HP di saku tetap berbunyi.
 *
 * Status "terlihat" sengaja tidak dilacak lewat presence: di iOS halaman
 * bisa dibekukan tanpa sempat melapor "hidden", lalu push terlewat. Ack per
 * notifikasi hanya datang dari tab yang benar-benar menampilkannya.
 */
import { randomUUID } from "node:crypto";
import type { SessionStore } from "../../db";
import type { AgentNotification, AgentNotificationKind, InteractivePrompt } from "../../types";
import type { PushSubscriptionRow } from "../db/push";
import type { TurnOutcome } from "./turn-stream";
import {
  generateVapidKeys,
  isValidAuthSecret,
  isValidEndpoint,
  isValidP256dh,
  type PushResult,
  sendPush,
} from "./web-push";

/**
 * Klaim `sub` VAPID. Apple menolak placeholder (`mailto:x@localhost`), jadi
 * default-nya URL proyek; bisa diganti `KCG_VAPID_SUBJECT`.
 */
export const DEFAULT_VAPID_SUBJECT = "https://github.com/forrealss/kcgcode";

/** Jeda menunggu `notify_ack` dari tab yang terlihat sebelum mengirim push. */
export const ACK_WINDOW_MS = 2500;

/** Batas perangkat berlangganan (cegah tabel tumbuh tanpa batas). */
export const MAX_PUSH_SUBSCRIPTIONS = 20;

const TITLES: Record<AgentNotificationKind, string> = {
  permission: "Permission needed",
  question: "The agent has a question",
  done: "Agent finished",
  failed: "Agent stopped with an error",
  test: "Notifications are on",
};

/** Push untuk kartu yang menunggu jawaban lebih mendesak dari kabar selesai. */
const URGENCY: Record<AgentNotificationKind, "high" | "normal"> = {
  permission: "high",
  question: "high",
  done: "normal",
  failed: "normal",
  test: "high",
};

/** Simpan di layanan push maksimal 12 jam bila perangkat offline. */
const PUSH_TTL_SEC = 12 * 3600;

export interface SubscribeInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface PushDeviceInfo {
  id: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
}

export type NotificationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface NotificationServiceOptions {
  store: SessionStore;
  /** Kirim `notify` ke tab yang terbuka (WebSocket gateway). */
  broadcast: (notification: AgentNotification) => void;
  subject?: string;
  ackWindowMs?: number;
  now?: () => number;
  fetchFn?: typeof fetch;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  log?: (msg: string) => void;
}

export interface NotificationService {
  /** Kartu izin/pertanyaan baru dari agent. */
  promptAsked(prompt: InteractivePrompt): void;
  /** Turn berakhir dengan sendirinya. */
  turnEnded(sessionId: string, outcome: TurnOutcome): void;
  /** Tab yang terlihat sudah menampilkan notifikasi `id`. */
  ack(id: string, endpoint: string): void;
  /** Kunci publik VAPID (`applicationServerKey` di browser). */
  publicKey(): Promise<string>;
  /**
   * Daftarkan / perbarui perangkat. `refreshOnly`: hanya perbarui bila sudah
   * terdaftar (sinkron saat app dibuka) — perangkat yang dihapus dari
   * Settings atau lewat `reset-lock` tidak hidup lagi diam-diam (`null`).
   */
  subscribe(
    input: SubscribeInput,
    opts?: { refreshOnly?: boolean },
  ): NotificationResult<PushDeviceInfo | null>;
  unsubscribe(id: string): boolean;
  listDevices(): PushDeviceInfo[];
  /** Kirim notifikasi uji langsung (tanpa jendela ack) ke satu perangkat. */
  sendTest(id: string): Promise<NotificationResult<null>>;
  /** Hentikan timer yang tertunda (shutdown). */
  close(): void;
}

function toDevice(row: PushSubscriptionRow): PushDeviceInfo {
  return {
    id: row.id,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

export function createNotificationService(opts: NotificationServiceOptions): NotificationService {
  const { store, broadcast } = opts;
  const subject = opts.subject ?? process.env.KCG_VAPID_SUBJECT ?? DEFAULT_VAPID_SUBJECT;
  const ackWindowMs = opts.ackWindowMs ?? ACK_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const log = opts.log ?? ((msg: string) => console.warn(`[kcg-code] ${msg}`));

  /** Notifikasi yang masih menunggu ack: id -> endpoint yang sudah ack. */
  const pending = new Map<string, { acked: Set<string>; timer: unknown }>();

  let vapidPromise: Promise<{ publicKey: string; privateJwk: string }> | null = null;
  function vapid() {
    vapidPromise ??= (async () => {
      const existing = store.getVapidKeys();
      if (existing) return existing;
      return store.saveVapidKeysOnce(await generateVapidKeys(), now());
    })().catch((e) => {
      vapidPromise = null;
      throw e;
    });
    return vapidPromise;
  }

  /** "Fix login bug · my-project" — judul Session & nama Project saja. */
  function describeSession(sessionId: string): { body: string; url: string } | null {
    const session = store.getSession(sessionId);
    if (!session.ok) return null;
    const project = store.getProjectById(session.data.projectId);
    const title = session.data.title?.trim() || "New session";
    const body = project.ok ? `${title} · ${project.data.name}` : title;
    return {
      body,
      url: `/projects/${session.data.projectId}/sessions/${sessionId}`,
    };
  }

  function build(kind: AgentNotificationKind, sessionId: string): AgentNotification | null {
    const info = describeSession(sessionId);
    if (!info) return null;
    return {
      id: randomUUID(),
      kind,
      sessionId,
      title: TITLES[kind],
      body: info.body,
      url: info.url,
      createdAt: now(),
    };
  }

  async function deliver(
    n: AgentNotification,
    targets: PushSubscriptionRow[],
  ): Promise<PushResult[]> {
    if (targets.length === 0) return [];
    const keys = await vapid();
    const payload = JSON.stringify(n);
    return Promise.all(
      targets.map(async (sub) => {
        const res = await sendPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapid: keys,
            subject,
            ttlSec: PUSH_TTL_SEC,
            urgency: URGENCY[n.kind],
            fetchFn: opts.fetchFn,
          },
        );
        if (!res.ok) {
          // Subscription kedaluwarsa / dicabut user di browser -> buang.
          if (res.gone) store.deletePushSubscriptionByEndpoint(sub.endpoint);
          else log(`web push gagal (${res.status}): ${res.reason}`);
        }
        return res;
      }),
    );
  }

  function dispatch(n: AgentNotification): void {
    broadcast(n);
    if (store.listPushSubscriptions().length === 0) return;
    const entry = { acked: new Set<string>(), timer: null as unknown };
    entry.timer = setTimeoutFn(() => {
      pending.delete(n.id);
      // Daftar dibaca ulang: perangkat bisa ditambah/dihapus selama jendela ack.
      const targets = store.listPushSubscriptions().filter((s) => !entry.acked.has(s.endpoint));
      void deliver(n, targets).catch((e) => log(`web push gagal: ${String(e)}`));
    }, ackWindowMs);
    pending.set(n.id, entry);
  }

  return {
    promptAsked(prompt) {
      const n = build(prompt.kind === "permission" ? "permission" : "question", prompt.sessionId);
      if (n) dispatch(n);
    },

    turnEnded(sessionId, outcome) {
      const n = build(outcome, sessionId);
      if (n) dispatch(n);
    },

    ack(id, endpoint) {
      pending.get(id)?.acked.add(endpoint);
    },

    async publicKey() {
      return (await vapid()).publicKey;
    },

    subscribe(input, subOpts = {}) {
      if (!isValidEndpoint(input.endpoint)) return { ok: false, error: "PUSH_ENDPOINT_INVALID" };
      if (!isValidP256dh(input.p256dh) || !isValidAuthSecret(input.auth)) {
        return { ok: false, error: "PUSH_KEYS_INVALID" };
      }
      const existing = store.listPushSubscriptions();
      if (subOpts.refreshOnly && !existing.some((s) => s.endpoint === input.endpoint)) {
        return { ok: true, data: null };
      }
      if (
        existing.length >= MAX_PUSH_SUBSCRIPTIONS &&
        !existing.some((s) => s.endpoint === input.endpoint)
      ) {
        return { ok: false, error: "PUSH_LIMIT" };
      }
      const ua = input.userAgent ? input.userAgent.slice(0, 512) : null;
      const row = store.upsertPushSubscription({ ...input, userAgent: ua }, now());
      return { ok: true, data: toDevice(row) };
    },

    unsubscribe(id) {
      return store.deletePushSubscription(id);
    },

    listDevices() {
      return store.listPushSubscriptions().map(toDevice);
    },

    async sendTest(id) {
      const sub = store.getPushSubscription(id);
      if (!sub) return { ok: false, error: "PUSH_DEVICE_NOT_FOUND" };
      const n: AgentNotification = {
        id: randomUUID(),
        kind: "test",
        sessionId: null,
        title: TITLES.test,
        body: "You'll get a notification like this when an agent needs you.",
        url: "/settings/notifications",
        createdAt: now(),
      };
      const [res] = await deliver(n, [sub]);
      if (!res || res.ok) return { ok: true, data: null };
      return { ok: false, error: res.gone ? "PUSH_DEVICE_GONE" : "PUSH_SEND_FAILED" };
    },

    close() {
      for (const entry of pending.values()) clearTimeoutFn(entry.timer);
      pending.clear();
    },
  };
}
