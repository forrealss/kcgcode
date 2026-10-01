/**
 * Passkey (WebAuthn) — alur keamanan service. Verifikasi kriptografi
 * (`@simplewebauthn/server`) diinjeksi agar alur bisa diuji tanpa
 * authenticator nyata; yang diuji di sini: origin/RP ID, challenge sekali
 * pakai, konfirmasi sandi, isolasi per domain, counter, rate limit.
 */
import { describe, expect, test } from "bun:test";
import { openSessionStore } from "../../../db";
import { createAuthService } from "../auth";
import {
  CHALLENGE_TTL_MS,
  cleanPasskeyName,
  createPasskeyService,
  defaultPasskeyName,
  webAuthnOrigin,
  webAuthnOriginForRead,
} from "../auth-passkeys";

const ORIGIN = "https://me.kcgcode.dev";

/** Kode error dari Result (undefined bila sukses). */
function err(r: { ok: boolean }): string | undefined {
  return r.ok ? undefined : (r as { error?: string }).error;
}

function req(origin: string | null = ORIGIN, host = "me.kcgcode.dev", ua = "Mozilla (iPhone)") {
  const headers = new Headers({ host, "user-agent": ua });
  if (origin) headers.set("origin", origin);
  return new Request("http://127.0.0.1:3000/api/auth/passkeys/x", { method: "POST", headers });
}

async function harness() {
  let t = 1_000_000;
  const store = openSessionStore(":memory:");
  const auth = createAuthService({
    store,
    now: () => t,
    hash: async (s) => `h:${s}`,
    verify: async (s, h) => h === `h:${s}`,
  });
  await auth.setLock({ kind: "pin", secret: "482913" }, { ip: "1.1.1.1", userAgent: null });

  /** Credential yang akan "dihasilkan" verifikasi palsu berikutnya. */
  let nextCredId = "cred-1";
  let authOk = true;
  let lastAuthCall: { expectedOrigin: unknown; expectedRPID: unknown; counter: number } | null =
    null;

  const passkeys = createPasskeyService({
    store,
    auth,
    now: () => t,
    verifyRegistration: (async (o: { expectedOrigin: string; expectedRPID: string }) => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: nextCredId,
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        origin: o.expectedOrigin,
        rpID: o.expectedRPID,
      },
    })) as never,
    verifyAuthentication: (async (o: {
      expectedOrigin: string;
      expectedRPID: string;
      credential: { counter: number };
    }) => {
      lastAuthCall = {
        expectedOrigin: o.expectedOrigin,
        expectedRPID: o.expectedRPID,
        counter: o.credential.counter,
      };
      return {
        verified: authOk,
        authenticationInfo: { newCounter: o.credential.counter + 1 },
      };
    }) as never,
  });

  async function register(r: Request = req(), credId = "cred-1") {
    nextCredId = credId;
    const opts = await passkeys.registrationOptions(r, "482913", "1.1.1.1");
    if (!opts.ok) throw new Error(opts.error);
    return passkeys.register(r, {
      challengeId: opts.data.challengeId,
      response: { id: credId } as never,
    });
  }

  return {
    store,
    auth,
    passkeys,
    register,
    advance: (ms: number) => {
      t += ms;
    },
    setAuthOk: (v: boolean) => {
      authOk = v;
    },
    lastAuthCall: () => lastAuthCall,
  };
}

describe("webAuthnOrigin", () => {
  test("https dengan Origin == host -> rpId = hostname", () => {
    expect(webAuthnOrigin(req())).toEqual({ origin: ORIGIN, rpId: "me.kcgcode.dev" });
  });

  test("http://localhost (secure context) diizinkan, port diabaikan di rpId", () => {
    expect(webAuthnOrigin(req("http://localhost:3000", "localhost:3000"))).toEqual({
      origin: "http://localhost:3000",
      rpId: "localhost",
    });
  });

  test("ditolak: tanpa Origin, Origin lintas situs, http non-localhost, alamat IP", () => {
    expect(webAuthnOrigin(req(null))).toBeNull();
    expect(webAuthnOrigin(req("https://evil.example", "me.kcgcode.dev"))).toBeNull();
    expect(webAuthnOrigin(req("http://me.kcgcode.dev", "me.kcgcode.dev"))).toBeNull();
    expect(webAuthnOrigin(req("https://192.168.1.5", "192.168.1.5"))).toBeNull();
  });
});

describe("webAuthnOriginForRead (GET tanpa Origin)", () => {
  /** GET same-origin seperti yang dikirim browser: TANPA header Origin. */
  const get = (url: string, headers: Record<string, string>) =>
    new Request(url, { method: "GET", headers });

  test("lewat tunnel https: host + x-forwarded-proto", () => {
    expect(
      webAuthnOriginForRead(
        get("http://127.0.0.1:3000/x", {
          host: "me.kcgcode.dev",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toEqual({ origin: ORIGIN, rpId: "me.kcgcode.dev" });
  });

  test("localhost langsung", () => {
    expect(
      webAuthnOriginForRead(get("http://localhost:3000/x", { host: "localhost:3000" })),
    ).toEqual({ origin: "http://localhost:3000", rpId: "localhost" });
  });

  test("http non-localhost & IP tetap ditolak", () => {
    expect(webAuthnOriginForRead(get("http://me.lan/x", { host: "me.lan" }))).toBeNull();
    expect(
      webAuthnOriginForRead(get("http://192.168.1.5:3000/x", { host: "192.168.1.5:3000" })),
    ).toBeNull();
  });

  test("ada Origin -> aturan ketat (Origin harus == host)", () => {
    expect(
      webAuthnOriginForRead(
        get("http://127.0.0.1/x", { host: "me.kcgcode.dev", origin: "https://evil.example" }),
      ),
    ).toBeNull();
  });
});

describe("util", () => {
  test("nama bawaan dari user agent", () => {
    expect(defaultPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(
      "Passkey on iPhone",
    );
    expect(defaultPasskeyName("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Passkey on Linux");
    expect(defaultPasskeyName(null)).toBe("Passkey");
  });

  test("cleanPasskeyName: rapikan spasi, tolak kosong / terlalu panjang / kontrol", () => {
    expect(cleanPasskeyName("  My   Phone ")).toBe("My Phone");
    expect(cleanPasskeyName("   ")).toBeNull();
    expect(cleanPasskeyName("x".repeat(61))).toBeNull();
    expect(cleanPasskeyName("a\u0007b")).toBeNull();
  });
});

describe("pendaftaran", () => {
  test("wajib sandi saat ini yang benar", async () => {
    const h = await harness();
    const res = await h.passkeys.registrationOptions(req(), "000000", "2.2.2.2");
    expect(res).toEqual({ ok: false, error: "CURRENT_SECRET_INVALID" });
  });

  test("wajib kunci aktif & origin yang didukung", async () => {
    const h = await harness();
    expect(
      err(await h.passkeys.registrationOptions(req("http://me.lan", "me.lan"), "482913", "x")),
    ).toBe("PASSKEY_UNSUPPORTED_ORIGIN");
  });

  test("options meminta discoverable credential + user verification", async () => {
    const h = await harness();
    const res = await h.passkeys.registrationOptions(req(), "482913", "1.1.1.1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.options.rp.id).toBe("me.kcgcode.dev");
    expect(res.data.options.authenticatorSelection?.residentKey).toBe("required");
    expect(res.data.options.authenticatorSelection?.userVerification).toBe("required");
  });

  test("sukses: tersimpan dengan rpId, nama bawaan, tanpa membocorkan kunci publik", async () => {
    const h = await harness();
    const res = await h.register();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      name: "Passkey on iPhone",
      rpId: "me.kcgcode.dev",
      synced: true,
      usableHere: true,
    });
    expect(JSON.stringify(h.passkeys.list(req()))).not.toContain("publicKey");
  });

  test("challenge sekali pakai & kedaluwarsa", async () => {
    const h = await harness();
    const opts = await h.passkeys.registrationOptions(req(), "482913", "1.1.1.1");
    if (!opts.ok) throw new Error("options");
    const input = { challengeId: opts.data.challengeId, response: { id: "cred-1" } as never };
    expect((await h.passkeys.register(req(), input)).ok).toBe(true);
    // Dipakai ulang -> ditolak.
    expect(err(await h.passkeys.register(req(), input))).toBe("PASSKEY_CHALLENGE_INVALID");

    const opts2 = await h.passkeys.registrationOptions(req(), "482913", "1.1.1.1");
    if (!opts2.ok) throw new Error("options");
    h.advance(CHALLENGE_TTL_MS + 1);
    expect(
      err(
        await h.passkeys.register(req(), {
          challengeId: opts2.data.challengeId,
          response: { id: "cred-2" } as never,
        }),
      ),
    ).toBe("PASSKEY_CHALLENGE_INVALID");
  });

  test("challenge dari domain lain tidak bisa dipakai", async () => {
    const h = await harness();
    const opts = await h.passkeys.registrationOptions(req(), "482913", "1.1.1.1");
    if (!opts.ok) throw new Error("options");
    const other = req("https://other.kcgcode.dev", "other.kcgcode.dev");
    const res = await h.passkeys.register(other, {
      challengeId: opts.data.challengeId,
      response: { id: "cred-1" } as never,
    });
    expect(err(res)).toBe("PASSKEY_CHALLENGE_INVALID");
  });
});

describe("login passkey", () => {
  async function loginOnce(
    h: Awaited<ReturnType<typeof harness>>,
    credId = "cred-1",
    r: Request = req(),
  ) {
    const opts = await h.passkeys.authenticationOptions(r, "9.9.9.9");
    if (!opts.ok) return opts;
    return h.passkeys.login(
      r,
      { challengeId: opts.data.challengeId, response: { id: credId } as never },
      { ip: "9.9.9.9", userAgent: "UA" },
    );
  }

  test("sukses -> sesi baru; counter & last used diperbarui", async () => {
    const h = await harness();
    await h.register();
    const res = await loginOnce(h);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.auth.authenticate(res.data.token)).not.toBeNull();
    expect(h.lastAuthCall()).toMatchObject({
      expectedOrigin: ORIGIN,
      expectedRPID: "me.kcgcode.dev",
      counter: 0,
    });
    const [p] = h.store.listPasskeys();
    expect(p?.counter).toBe(1);
    expect(p?.lastUsedAt).not.toBeNull();
  });

  test("availability dari GET lock screen (tanpa Origin) melihat passkey", async () => {
    // Regresi: dulu availability memakai aturan Origin ketat sehingga GET
    // browser (tanpa Origin) selalu dapat count 0 -> tombol passkey tak muncul.
    const h = await harness();
    await h.register();
    const lockScreenGet = new Request("http://127.0.0.1:3000/api/auth/passkeys/availability", {
      headers: { host: "me.kcgcode.dev", "x-forwarded-proto": "https" },
    });
    expect(h.passkeys.availability(lockScreenGet)).toEqual({ supported: true, count: 1 });
    expect(h.passkeys.list(lockScreenGet)[0]?.usableHere).toBe(true);
  });

  test("availability: hanya menghitung passkey milik alamat ini", async () => {
    const h = await harness();
    await h.register();
    expect(h.passkeys.availability(req())).toEqual({ supported: true, count: 1 });
    const other = req("https://other.kcgcode.dev", "other.kcgcode.dev");
    expect(h.passkeys.availability(other)).toEqual({ supported: true, count: 0 });
    expect(err(await h.passkeys.authenticationOptions(other, "x"))).toBe("PASSKEY_NONE");
  });

  test("passkey domain lain ditolak walau challenge valid", async () => {
    const h = await harness();
    await h.register();
    const other = req("https://other.kcgcode.dev", "other.kcgcode.dev");
    await h.register(other, "cred-other");
    // Di domain `me`, kirim credential milik `other`.
    const res = await loginOnce(h, "cred-other");
    expect(err(res)).toBe("PASSKEY_INVALID");
  });

  test("verifikasi gagal berulang -> kena rate limit yang sama dengan PIN", async () => {
    const h = await harness();
    await h.register();
    h.setAuthOk(false);
    let last: { ok: boolean } = { ok: true };
    for (let i = 0; i < 6; i++) last = await loginOnce(h);
    expect(err(last)?.startsWith("AUTH_RATE_LIMITED:")).toBe(true);
    // Saat terkunci, options pun ditolak.
    expect(err(await h.passkeys.authenticationOptions(req(), "9.9.9.9"))).toMatch(
      /^AUTH_RATE_LIMITED:/,
    );
  });
});

describe("kelola & siklus hidup kunci", () => {
  test("rename & hapus", async () => {
    const h = await harness();
    const reg = await h.register();
    if (!reg.ok) throw new Error("register");
    expect(h.passkeys.rename(reg.data.id, "  Laptop kerja ").ok).toBe(true);
    expect(h.store.listPasskeys()[0]?.name).toBe("Laptop kerja");
    expect(err(h.passkeys.rename(reg.data.id, ""))).toBe("PASSKEY_NAME_INVALID");
    expect(h.passkeys.remove(reg.data.id).ok).toBe(true);
    expect(err(h.passkeys.remove(reg.data.id))).toBe("PASSKEY_NOT_FOUND");
  });

  test("hapus kunci / reset-lock ikut menghapus semua passkey", async () => {
    const h = await harness();
    await h.register();
    await h.auth.removeLock("482913", { ip: "1.1.1.1", userAgent: null });
    expect(h.store.listPasskeys()).toHaveLength(0);

    await h.auth.setLock({ kind: "pin", secret: "482913" }, { ip: "1.1.1.1", userAgent: null });
    await h.register(req(), "cred-9");
    h.auth.resetLock();
    expect(h.store.listPasskeys()).toHaveLength(0);
  });
});
