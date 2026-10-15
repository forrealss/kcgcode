/**
 * Registri subscriber WebSocket_Gateway: peta koneksi -> info attach,
 * pengiriman aman per-Client, dan primitif broadcast.
 *
 * Kegagalan `send` ke satu Client ditangkap per-Client (subscriber dihapus)
 * tanpa menghentikan broadcast ke Client lain (Requirement 5.3).
 */
import type { ServerMessage } from "../../../ws-protocol";
import type { AttachedInfo, Subscriber } from "./types";

export interface SubscriberRegistry {
  /** Daftarkan (atau timpa) info attach sebuah koneksi. */
  register(sub: Subscriber, info: AttachedInfo): void;
  /** Kirim pesan; bila `send` melempar, hapus subscriber (Req 5.3). */
  sendSafe(sub: Subscriber, msg: ServerMessage): boolean;
  /** Broadcast ke koneksi yang attach `sessionId`. */
  broadcast(sessionId: string, build: () => ServerMessage): void;
  /**
   * Broadcast ke seluruh koneksi — dipakai pesan yang relevan lintas Session
   * (mis. `session_title`: pemilik koneksi mungkin sedang membuka daftar
   * Session, bukan me-attach satu Session).
   */
  broadcastAll(build: () => ServerMessage): void;
  /** Broadcast hanya ke koneksi mode daftar (`sessionId: null`). */
  broadcastListMode(build: () => ServerMessage): void;
  detach(sub: Subscriber): void;
  subscriberCount(sessionId: string): number;
}

export function createSubscriberRegistry(): SubscriberRegistry {
  const subs = new Map<Subscriber, AttachedInfo>();

  function register(sub: Subscriber, info: AttachedInfo): void {
    subs.set(sub, info);
  }

  function sendSafe(sub: Subscriber, msg: ServerMessage): boolean {
    try {
      sub.send(msg);
      return true;
    } catch {
      subs.delete(sub);
      return false;
    }
  }

  function broadcast(sessionId: string, build: () => ServerMessage): void {
    for (const [sub, info] of subs) {
      if (info.sessionId !== sessionId) continue;
      sendSafe(sub, build());
    }
  }

  function broadcastAll(build: () => ServerMessage): void {
    for (const sub of subs.keys()) {
      sendSafe(sub, build());
    }
  }

  function broadcastListMode(build: () => ServerMessage): void {
    for (const [sub, info] of subs) {
      if (info.sessionId === null) sendSafe(sub, build());
    }
  }

  function detach(sub: Subscriber): void {
    subs.delete(sub);
  }

  function subscriberCount(sessionId: string): number {
    let n = 0;
    for (const info of subs.values()) {
      if (info.sessionId === sessionId) n += 1;
    }
    return n;
  }

  return {
    register,
    sendSafe,
    broadcast,
    broadcastAll,
    broadcastListMode,
    detach,
    subscriberCount,
  };
}
