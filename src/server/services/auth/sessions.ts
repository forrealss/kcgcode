/**
 * Sesi login per perangkat: token acak 256-bit (DB hanya menyimpan
 * SHA-256-nya), validasi + pembaruan aktivitas (dengan throttle tulis),
 * kunci otomatis karena idle, pencabutan, dan notifikasi sesi berakhir.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { SessionStore } from "../../../db";
import type { AuthSessionRow } from "../../db/auth";
import { type DeviceInfo, type IssuedSession, type LoginContext, SESSION_TTL_MS } from "./types";
import { constantTimeEqual, hashToken } from "./validation";

/** Jangan tulis `last_seen_at` ke DB lebih sering dari ini per sesi. */
const TOUCH_THROTTLE_MS = 30_000;

/** Sesi valid: belum kedaluwarsa dan belum melewati batas idle. */
function isAlive(s: AuthSessionRow, t: number, autoLockMinutes: number): boolean {
  if (s.expiresAt <= t) return false;
  if (autoLockMinutes > 0 && t - s.lastSeenAt > autoLockMinutes * 60_000) return false;
  return true;
}

export interface AuthSessionsDeps {
  store: SessionStore;
  now: () => number;
  /** Batas idle saat ini (menit; 0 = tidak pernah) — dibaca dari pengaturan. */
  autoLockMinutes: () => number;
}

export class AuthSessions {
  private readonly store: SessionStore;
  private readonly now: () => number;
  private readonly autoLockMinutes: () => number;
  private readonly lastTouch = new Map<string, number>();
  private readonly endedListeners = new Set<(sessionId: string) => void>();

  constructor(deps: AuthSessionsDeps) {
    this.store = deps.store;
    this.now = deps.now;
    this.autoLockMinutes = deps.autoLockMinutes;
  }

  onEnded(cb: (sessionId: string) => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  private ended(sessionId: string): void {
    this.lastTouch.delete(sessionId);
    for (const cb of this.endedListeners) cb(sessionId);
  }

  /** Hapus sesi dari DB lalu beri tahu listener. */
  revoke(id: string): void {
    this.store.deleteAuthSession(id);
    this.ended(id);
  }

  find(token: string | null): AuthSessionRow | null {
    if (!token || token.length < 32 || token.length > 128) return null;
    const row = this.store.getAuthSessionByHash(hashToken(token));
    if (!row) return null;
    // Pembanding waktu-konstan (defensif; lookup DB sudah berdasarkan hash).
    if (!constantTimeEqual(row.tokenHash, hashToken(token))) return null;
    return row;
  }

  authenticate(token: string | null): AuthSessionRow | null {
    const row = this.find(token);
    if (!row) return null;
    const t = this.now();
    if (!isAlive(row, t, this.autoLockMinutes())) {
      this.revoke(row.id);
      return null;
    }
    const last = this.lastTouch.get(row.id) ?? row.lastSeenAt;
    if (t - last >= TOUCH_THROTTLE_MS) {
      this.store.touchAuthSession(row.id, t);
      this.lastTouch.set(row.id, t);
      row.lastSeenAt = t;
    }
    return row;
  }

  isSessionAlive(sessionId: string): boolean {
    const row = this.store.getAuthSessionById(sessionId);
    if (!row) return false;
    const t = this.now();
    if (!isAlive(row, t, this.autoLockMinutes())) {
      this.revoke(row.id);
      return false;
    }
    const last = this.lastTouch.get(row.id) ?? row.lastSeenAt;
    if (t - last >= TOUCH_THROTTLE_MS) {
      this.store.touchAuthSession(row.id, t);
      this.lastTouch.set(row.id, t);
    }
    return true;
  }

  issue(ctx: LoginContext): IssuedSession {
    const token = randomBytes(32).toString("base64url");
    const t = this.now();
    const session: AuthSessionRow = {
      id: randomUUID(),
      tokenHash: hashToken(token),
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
      createdAt: t,
      lastSeenAt: t,
      expiresAt: t + SESSION_TTL_MS,
    };
    this.store.insertAuthSession(session);
    this.lastTouch.set(session.id, t);
    return { token, session };
  }

  logout(token: string | null): void {
    const row = this.find(token);
    if (row) this.revoke(row.id);
  }

  revokeAllExcept(keepId: string | null): void {
    for (const s of this.store.listAuthSessions()) {
      if (s.id !== keepId) this.revoke(s.id);
    }
  }

  listDevices(currentToken: string | null): DeviceInfo[] {
    const cur = this.find(currentToken);
    const t = this.now();
    const autoLock = this.autoLockMinutes();
    return this.store
      .listAuthSessions()
      .filter((s) => isAlive(s, t, autoLock))
      .map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === cur?.id,
      }));
  }

  /** Bersihkan sesi kedaluwarsa & idle. */
  sweep(): void {
    const t = this.now();
    const autoLock = this.autoLockMinutes();
    for (const s of this.store.listAuthSessions()) {
      if (!isAlive(s, t, autoLock)) this.revoke(s.id);
    }
  }
}
