/**
 * Unit test Auth_Service (kunci aplikasi). Hash diinjeksi (cepat) kecuali
 * satu test yang memastikan default argon2id berfungsi.
 */
import { describe, expect, test } from "bun:test";
import { openSessionStore } from "../../../db";
import {
  AVATAR_MAX_BYTES,
  createAuthService,
  hashToken,
  lockoutMs,
  SESSION_TTL_MS,
  sniffImageMime,
  validateSecret,
} from "../auth";

const fastHash = async (s: string) => `h:${s}`;
const fastVerify = async (s: string, h: string) => h === `h:${s}`;
const ctx = { ip: "1.1.1.1", userAgent: "test-agent" };

function harness() {
  let t = 1_000_000;
  const store = openSessionStore(":memory:");
  const auth = createAuthService({ store, now: () => t, hash: fastHash, verify: fastVerify });
  const ended: string[] = [];
  auth.onSessionEnded((id) => ended.push(id));
  return {
    store,
    auth,
    ended,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe("validateSecret", () => {
  test("PIN: angka saja, 6-12 digit, tolak pola trivial", () => {
    expect(validateSecret("pin", "482915")).toBeNull();
    expect(validateSecret("pin", "48291a")).toBe("PIN_DIGITS_ONLY");
    expect(validateSecret("pin", "48291")).toBe("PIN_LENGTH");
    expect(validateSecret("pin", "4829154829154")).toBe("PIN_LENGTH");
    expect(validateSecret("pin", "111111")).toBe("PIN_TOO_SIMPLE");
    expect(validateSecret("pin", "123456")).toBe("PIN_TOO_SIMPLE");
    expect(validateSecret("pin", "987654")).toBe("PIN_TOO_SIMPLE");
  });

  test("password: 8-128 karakter, bukan spasi saja", () => {
    expect(validateSecret("password", "correct horse")).toBeNull();
    expect(validateSecret("password", "short")).toBe("PASSWORD_TOO_SHORT");
    expect(validateSecret("password", "        ")).toBe("PASSWORD_TOO_SHORT");
    expect(validateSecret("password", "x".repeat(129))).toBe("PASSWORD_TOO_LONG");
  });
});

describe("util", () => {
  test("sniffImageMime dari magic bytes", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffImageMime(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  test("lockoutMs: bebas lalu berlipat, dibatasi maksimum", () => {
    expect(lockoutMs(4, 5)).toBe(0);
    expect(lockoutMs(5, 5)).toBe(30_000);
    expect(lockoutMs(6, 5)).toBe(60_000);
    expect(lockoutMs(50, 5)).toBe(15 * 60_000);
  });
});

describe("createAuthService", () => {
  test("tanpa kunci: terbuka, login ditolak AUTH_NOT_CONFIGURED", async () => {
    const h = harness();
    expect(h.auth.isProtected()).toBe(false);
    const st = h.auth.status(null, ctx.ip);
    expect(st).toMatchObject({ protected: false, authenticated: true, lockKind: null });
    expect(await h.auth.login("whatever", ctx)).toEqual({
      ok: false,
      error: "AUTH_NOT_CONFIGURED",
    });
  });

  test("atur kunci -> sesi baru; token disimpan sebagai hash, bukan mentah", async () => {
    const h = harness();
    const res = await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.auth.isProtected()).toBe(true);
    const rows = h.store.listAuthSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(res.data.token));
    expect(rows[0]?.tokenHash).not.toBe(res.data.token);
    expect(h.store.getAuthSettings(0).lockHash).not.toContain("482915".repeat(2));
    expect(h.auth.status(res.data.token, ctx.ip)).toMatchObject({
      protected: true,
      authenticated: true,
      lockKind: "pin",
    });
    expect(h.auth.status(null, ctx.ip).authenticated).toBe(false);
    expect(h.auth.status("x".repeat(43), ctx.ip).authenticated).toBe(false);
  });

  test("login benar/salah; logout mencabut sesi", async () => {
    const h = harness();
    await h.auth.setLock({ kind: "password", secret: "correct horse" }, ctx);
    expect((await h.auth.login("wrong horse", ctx)).ok).toBe(false);
    const ok = await h.auth.login("correct horse", ctx);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(h.auth.authenticate(ok.data.token)?.id).toBe(ok.data.session.id);
    h.auth.logout(ok.data.token);
    expect(h.auth.authenticate(ok.data.token)).toBeNull();
    expect(h.ended).toContain(ok.data.session.id);
  });

  test("ganti kunci wajib sandi lama & mencabut semua sesi lain", async () => {
    const h = harness();
    const first = await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    const other = await h.auth.login("482915", { ...ctx, ip: "2.2.2.2" });
    if (!first.ok || !other.ok) throw new Error("setup gagal");

    expect(await h.auth.setLock({ kind: "password", secret: "new password!" }, ctx)).toEqual({
      ok: false,
      error: "CURRENT_SECRET_INVALID",
    });
    const changed = await h.auth.setLock(
      { kind: "password", secret: "new password!", current: "482915" },
      ctx,
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(h.auth.authenticate(first.data.token)).toBeNull();
    expect(h.auth.authenticate(other.data.token)).toBeNull();
    expect(h.auth.authenticate(changed.data.token)).not.toBeNull();
    expect(h.auth.status(null, ctx.ip).lockKind).toBe("password");
    expect((await h.auth.login("482915", ctx)).ok).toBe(false);
  });

  test("hapus kunci wajib sandi saat ini", async () => {
    const h = harness();
    await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    expect((await h.auth.removeLock("000000", ctx)).ok).toBe(false);
    expect(h.auth.isProtected()).toBe(true);
    expect((await h.auth.removeLock("482915", ctx)).ok).toBe(true);
    expect(h.auth.isProtected()).toBe(false);
    expect(h.store.listAuthSessions()).toHaveLength(0);
  });

  test("kunci otomatis: sesi idle melewati batas ditolak & dihapus; aktivitas memperpanjang", async () => {
    const h = harness();
    const res = await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    if (!res.ok) throw new Error("setup gagal");
    expect(h.auth.setAutoLock(5).ok).toBe(true);

    // Aktif tiap 4 menit -> tetap hidup.
    for (let i = 0; i < 3; i++) {
      h.advance(4 * 60_000);
      expect(h.auth.authenticate(res.data.token)).not.toBeNull();
    }
    // Diam 6 menit -> terkunci.
    h.advance(6 * 60_000);
    expect(h.auth.authenticate(res.data.token)).toBeNull();
    expect(h.store.listAuthSessions()).toHaveLength(0);
    expect(h.ended).toContain(res.data.session.id);
  });

  test("auto-lock 0 = tidak pernah (hanya TTL 30 hari)", async () => {
    const h = harness();
    const res = await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    if (!res.ok) throw new Error("setup gagal");
    h.auth.setAutoLock(0);
    h.advance(10 * 24 * 60 * 60_000);
    expect(h.auth.authenticate(res.data.token)).not.toBeNull();
    h.advance(SESSION_TTL_MS);
    expect(h.auth.authenticate(res.data.token)).toBeNull();
    expect(h.auth.setAutoLock(7)).toEqual({ ok: false, error: "AUTO_LOCK_INVALID" });
  });

  test("isSessionAlive (WebSocket) ikut memperpanjang aktivitas", async () => {
    const h = harness();
    const res = await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    if (!res.ok) throw new Error("setup gagal");
    h.auth.setAutoLock(5);
    h.advance(4 * 60_000);
    expect(h.auth.isSessionAlive(res.data.session.id)).toBe(true);
    h.advance(4 * 60_000);
    expect(h.auth.isSessionAlive(res.data.session.id)).toBe(true);
    h.advance(6 * 60_000);
    expect(h.auth.isSessionAlive(res.data.session.id)).toBe(false);
    expect(h.auth.isSessionAlive("tidak-ada")).toBe(false);
  });

  test("anti brute-force per IP: 5 gagal bebas, lalu ditunda; sandi benar pun ditolak selama jeda", async () => {
    const h = harness();
    await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    const attacker = { ip: "6.6.6.6", userAgent: null };
    for (let i = 0; i < 4; i++) {
      expect(await h.auth.login("000000", attacker)).toEqual({ ok: false, error: "AUTH_INVALID" });
    }
    const fifth = await h.auth.login("000000", attacker);
    expect(!fifth.ok && fifth.error).toBe("AUTH_RATE_LIMITED:30");
    // Selama jeda, bahkan sandi benar ditolak (tidak ada oracle).
    const during = await h.auth.login("482915", attacker);
    expect(!during.ok && during.error.startsWith("AUTH_RATE_LIMITED")).toBe(true);
    expect(h.auth.status(null, attacker.ip).retryAfterSec).toBe(30);
    // IP lain tidak terdampak (masih di bawah batas global).
    expect((await h.auth.login("482915", ctx)).ok).toBe(true);
    // Setelah jeda lewat, boleh mencoba lagi.
    h.advance(31_000);
    expect((await h.auth.login("482915", attacker)).ok).toBe(true);
  });

  test("anti brute-force global: banyak IP berbeda tetap tertahan", async () => {
    const h = harness();
    await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const r = await h.auth.login("000000", { ip: `10.0.0.${i}`, userAgent: null });
      if (!r.ok && r.error.startsWith("AUTH_RATE_LIMITED")) limited = true;
    }
    expect(limited).toBe(true);
    const fresh = await h.auth.login("482915", { ip: "10.9.9.9", userAgent: null });
    expect(!fresh.ok && fresh.error.startsWith("AUTH_RATE_LIMITED")).toBe(true);
  });

  test("profil: nickname dirapikan & divalidasi; avatar disniff dan dibatasi ukurannya", async () => {
    const h = harness();
    expect(h.auth.setNickname("  Irsyad   Ibad ")).toEqual({
      ok: true,
      data: { nickname: "Irsyad Ibad", avatarUrl: null, avatarPreset: null },
    });
    expect(h.auth.setNickname("x".repeat(41))).toEqual({ ok: false, error: "NICKNAME_TOO_LONG" });
    expect(h.auth.setNickname("a\u0000b")).toEqual({ ok: false, error: "NICKNAME_INVALID" });
    expect(h.auth.setNickname("   ").ok && h.auth.status(null, "x").profile.nickname).toBeNull();

    const svg = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    expect(h.auth.setAvatar(svg, "image/png")).toEqual({
      ok: false,
      error: "UNSUPPORTED_IMAGE_MIME",
    });
    expect(h.auth.setAvatar(new Uint8Array(AVATAR_MAX_BYTES + 1), "image/png")).toEqual({
      ok: false,
      error: "AVATAR_TOO_LARGE",
    });
    const up = h.auth.setAvatar(PNG, "image/png");
    expect(up.ok && up.data.avatarUrl).toBe("/api/auth/avatar?v=1");
    expect(h.auth.getAvatar()?.mime).toBe("image/png");
    const again = h.auth.setAvatar(PNG, "image/png");
    expect(again.ok && again.data.avatarUrl).toBe("/api/auth/avatar?v=2");
    expect(h.auth.setAvatar(null, null).ok).toBe(true);
    expect(h.auth.getAvatar()).toBeNull();
  });

  test("avatar preset: valid dipakai; tak dikenal ditolak; eksklusif dengan foto", () => {
    const h = harness();
    expect(h.auth.setAvatarPreset("../etc")).toEqual({ ok: false, error: "AVATAR_PRESET_INVALID" });
    const cat = h.auth.setAvatarPreset("cat");
    expect(cat.ok && cat.data).toEqual({ nickname: null, avatarUrl: null, avatarPreset: "cat" });

    // Upload foto menggantikan preset.
    const photo = h.auth.setAvatar(PNG, "image/png");
    expect(photo.ok && photo.data.avatarPreset).toBeNull();
    expect(photo.ok && photo.data.avatarUrl).toMatch(/^\/api\/auth\/avatar\?v=\d+$/);

    // Pilih preset lagi menghapus foto.
    const rocket = h.auth.setAvatarPreset("rocket");
    expect(rocket.ok && rocket.data).toEqual({
      nickname: null,
      avatarUrl: null,
      avatarPreset: "rocket",
    });
    expect(h.auth.getAvatar()).toBeNull();

    // Hapus avatar -> kosong semua.
    expect(h.auth.setAvatar(null, null).ok).toBe(true);
    expect(h.auth.status(null, "x").profile).toEqual({
      nickname: null,
      avatarUrl: null,
      avatarPreset: null,
    });
  });

  test("perangkat: daftar, cabut lainnya, cabut satu", async () => {
    const h = harness();
    const me = await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    const b = await h.auth.login("482915", { ip: "2.2.2.2", userAgent: "phone" });
    const c = await h.auth.login("482915", { ip: "3.3.3.3", userAgent: "tablet" });
    if (!me.ok || !b.ok || !c.ok) throw new Error("setup gagal");
    const list = h.auth.listDevices(me.data.token);
    expect(list).toHaveLength(3);
    expect(list.filter((d) => d.current).map((d) => d.id)).toEqual([me.data.session.id]);

    h.auth.revokeDevice(b.data.session.id);
    expect(h.auth.authenticate(b.data.token)).toBeNull();
    h.auth.revokeOthers(me.data.token);
    expect(h.auth.authenticate(c.data.token)).toBeNull();
    expect(h.auth.authenticate(me.data.token)).not.toBeNull();
  });

  test("resetLock (CLI): kunci & semua sesi terhapus", async () => {
    const h = harness();
    await h.auth.setLock({ kind: "pin", secret: "482915" }, ctx);
    h.auth.resetLock();
    expect(h.auth.isProtected()).toBe(false);
    expect(h.store.listAuthSessions()).toHaveLength(0);
  });

  test("hash default = argon2id (tanpa injeksi)", async () => {
    const store = openSessionStore(":memory:");
    const auth = createAuthService({ store });
    const res = await auth.setLock({ kind: "password", secret: "correct horse" }, ctx);
    expect(res.ok).toBe(true);
    expect(store.getAuthSettings(0).lockHash?.startsWith("$argon2id$")).toBe(true);
    expect((await auth.login("correct horse", ctx)).ok).toBe(true);
    expect((await auth.login("wrong horse!", ctx)).ok).toBe(false);
  });
});
