/**
 * Penyimpanan challenge WebAuthn di memori server (bukan di klien).
 * Challenge sekali pakai, kedaluwarsa `CHALLENGE_TTL_MS`, terikat jenis
 * (register / login) dan asal (RP ID + origin) saat dibuat.
 */
import { randomUUID } from "node:crypto";
import { CHALLENGE_TTL_MS, type WebAuthnOrigin } from "./types";

export interface Challenge {
  kind: "register" | "login";
  challenge: string;
  rpId: string;
  origin: string;
  expiresAt: number;
}

export interface ChallengeStore {
  /** Simpan challenge baru; kembalikan id acak untuk klien. */
  put(c: Omit<Challenge, "expiresAt">): string;
  /** Ambil & HAPUS challenge (sekali pakai), pastikan jenis & asal sama. */
  take(id: unknown, kind: Challenge["kind"], origin: WebAuthnOrigin): Challenge | null;
}

export function createChallengeStore(now: () => number): ChallengeStore {
  const challenges = new Map<string, Challenge>();

  function sweepChallenges(): void {
    const t = now();
    for (const [id, c] of challenges) if (c.expiresAt <= t) challenges.delete(id);
    // Batas ukuran (permintaan options tanpa diselesaikan).
    while (challenges.size > 200) {
      const first = challenges.keys().next().value;
      if (first === undefined) break;
      challenges.delete(first);
    }
  }

  function put(c: Omit<Challenge, "expiresAt">): string {
    sweepChallenges();
    const id = randomUUID();
    challenges.set(id, { ...c, expiresAt: now() + CHALLENGE_TTL_MS });
    return id;
  }

  function take(id: unknown, kind: Challenge["kind"], origin: WebAuthnOrigin): Challenge | null {
    if (typeof id !== "string") return null;
    const c = challenges.get(id);
    challenges.delete(id);
    if (!c || c.kind !== kind || c.expiresAt <= now()) return null;
    if (c.rpId !== origin.rpId || c.origin !== origin.origin) return null;
    return c;
  }

  return { put, take };
}
