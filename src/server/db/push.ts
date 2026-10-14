/**
 * Repository Web Push: kunci VAPID server (`push_settings`, id = 1) dan
 * subscription per perangkat (`push_subscriptions`).
 *
 * Subscription sengaja TIDAK terikat ke sesi login: kunci otomatis
 * (auto-lock) mengakhiri sesi setelah idle, padahal justru saat itulah
 * notifikasi paling dibutuhkan. Perangkat dihapus manual dari Settings,
 * otomatis saat layanan push membalas 404/410, atau lewat `reset-lock`.
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export interface StoredVapidKeys {
  publicKey: string;
  privateJwk: string;
}

export interface PushSubscriptionRow {
  /** Id stabil (hash endpoint) — endpoint sendiri tidak dikirim ke browser. */
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
}

/** Id subscription = 16 hex pertama SHA-256 endpoint. */
export function pushSubscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

function mapSub(r: SubRow): PushSubscriptionRow {
  return {
    id: r.id,
    endpoint: r.endpoint,
    p256dh: r.p256dh,
    auth: r.auth,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };
}

export function createPushRepo(db: Database) {
  const q = {
    getVapid: db.query(
      "SELECT vapid_public_key, vapid_private_jwk FROM push_settings WHERE id = 1",
    ),
    setVapid: db.query(
      `INSERT OR IGNORE INTO push_settings (id, vapid_public_key, vapid_private_jwk, created_at)
       VALUES (1, ?, ?, ?)`,
    ),
    upsertSub: db.query(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at`,
    ),
    listSubs: db.query(
      `SELECT id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at
       FROM push_subscriptions ORDER BY created_at`,
    ),
    getSub: db.query(
      `SELECT id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at
       FROM push_subscriptions WHERE id = ?`,
    ),
    deleteSub: db.query("DELETE FROM push_subscriptions WHERE id = ?"),
    deleteSubByEndpoint: db.query("DELETE FROM push_subscriptions WHERE endpoint = ?"),
    deleteAllSubs: db.query("DELETE FROM push_subscriptions"),
  };

  function getVapidKeys(): StoredVapidKeys | null {
    const r = q.getVapid.get() as { vapid_public_key: string; vapid_private_jwk: string } | null;
    return r ? { publicKey: r.vapid_public_key, privateJwk: r.vapid_private_jwk } : null;
  }

  return {
    getVapidKeys,
    /**
     * Simpan kunci VAPID bila belum ada (INSERT OR IGNORE) lalu kembalikan
     * kunci yang tersimpan — dua proses yang berbalapan tetap memakai satu
     * pasangan kunci yang sama.
     */
    saveVapidKeysOnce(keys: StoredVapidKeys, now: number): StoredVapidKeys {
      q.setVapid.run(keys.publicKey, keys.privateJwk, now);
      return getVapidKeys() ?? keys;
    },
    upsertPushSubscription(
      sub: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
      now: number,
    ): PushSubscriptionRow {
      const id = pushSubscriptionId(sub.endpoint);
      q.upsertSub.run(id, sub.endpoint, sub.p256dh, sub.auth, sub.userAgent, now, now);
      return mapSub(q.getSub.get(id) as SubRow);
    },
    listPushSubscriptions(): PushSubscriptionRow[] {
      return (q.listSubs.all() as SubRow[]).map(mapSub);
    },
    getPushSubscription(id: string): PushSubscriptionRow | null {
      const r = q.getSub.get(id) as SubRow | null;
      return r ? mapSub(r) : null;
    },
    /** `true` bila ada baris yang terhapus. */
    deletePushSubscription(id: string): boolean {
      return q.deleteSub.run(id).changes > 0;
    },
    deletePushSubscriptionByEndpoint(endpoint: string): void {
      q.deleteSubByEndpoint.run(endpoint);
    },
    deleteAllPushSubscriptions(): void {
      q.deleteAllSubs.run();
    },
  };
}

export type PushRepo = ReturnType<typeof createPushRepo>;
