/**
 * Passkey (WebAuthn) — cara buka kunci TAMBAHAN di samping PIN/password.
 *
 * Model keamanan:
 * - PIN/password tetap wajib ada (cadangan bila passkey tak bisa dipakai).
 *   Mendaftarkan passkey butuh sesi login + konfirmasi sandi saat ini.
 *   Menghapus kunci / `kcgcode reset-lock` ikut menghapus semua passkey.
 * - Passkey terikat domain (RP ID). RP ID & origin diturunkan dari header
 *   `Origin` request yang WAJIB sama dengan host tujuan (pola yang sama
 *   dengan `originAllowed`) — tidak pernah dari input body. Hanya secure
 *   context (https, atau http://localhost) yang didukung, sesuai aturan
 *   WebAuthn di browser.
 * - Challenge sekali pakai, kedaluwarsa 5 menit, disimpan di memori server
 *   (bukan di klien). Login passkey kena anti brute-force yang sama dengan
 *   PIN/password.
 * - Verifikasi kriptografi (attestation, signature, counter) oleh
 *   `@simplewebauthn/server`. User verification (biometrik / PIN perangkat)
 *   diwajibkan.
 * - Hanya kunci publik yang disimpan.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { SessionStore } from "../../db";
import type { PasskeyRow } from "../db/auth";
import type { Result } from "../result";
import type { AuthService, IssuedSession, LoginContext } from "./auth";

export const PASSKEY_NAME_MAX = 60;
export const PASSKEY_MAX = 20;
/** Umur challenge (ms). Sama dengan timeout WebAuthn yang dikirim ke browser. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
const RP_NAME = "KCG Code";
/** User handle tetap — app satu pemilik, tidak ada akun. */
const USER_NAME = "kcgcode-owner";

/** Asal WebAuthn yang tervalidasi dari sebuah request. */
export interface WebAuthnOrigin {
  /** Origin lengkap, mis. `https://irsyad.kcgcode.dev`. */
  origin: string;
  /** RP ID = hostname tanpa port, mis. `irsyad.kcgcode.dev`. */
  rpId: string;
}

/** Info passkey yang aman dikirim ke browser (tanpa kunci publik). */
export interface PasskeyInfo {
  id: string;
  name: string;
  rpId: string;
  /** Passkey tersinkron (iCloud Keychain, Google Password Manager, dsb.). */
  synced: boolean;
  createdAt: number;
  lastUsedAt: number | null;
  /** Bisa dipakai di alamat yang sedang dibuka. */
  usableHere: boolean;
}

export interface PasskeyAvailability {
  /** Alamat ini mendukung WebAuthn (secure context). */
  supported: boolean;
  /** Jumlah passkey terdaftar untuk alamat ini. */
  count: number;
}

export interface PasskeyService {
  /** Status untuk lock screen (publik): boleh menampilkan tombol passkey? */
  availability(req: Request): PasskeyAvailability;
  list(req: Request): PasskeyInfo[];
  /** Mulai pendaftaran — wajib konfirmasi sandi saat ini. */
  registrationOptions(
    req: Request,
    current: string,
    ip: string,
  ): Promise<Result<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>>;
  register(
    req: Request,
    input: { challengeId: string; response: RegistrationResponseJSON; name?: string },
  ): Promise<Result<PasskeyInfo>>;
  /** Mulai login passkey (publik). */
  authenticationOptions(
    req: Request,
    ip: string,
  ): Promise<Result<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>>;
  login(
    req: Request,
    input: { challengeId: string; response: AuthenticationResponseJSON },
    ctx: LoginContext,
  ): Promise<Result<IssuedSession>>;
  rename(id: string, name: string): Result<PasskeyInfo>;
  remove(id: string): Result<null>;
}

export interface PasskeyServiceOptions {
  store: SessionStore;
  auth: AuthService;
  now?: () => number;
  /** Injeksi verifikasi (test) — default `@simplewebauthn/server`. */
  verifyRegistration?: typeof verifyRegistrationResponse;
  verifyAuthentication?: typeof verifyAuthenticationResponse;
}

// ------------------------------------------------------------ util murni ----

/**
 * Turunkan origin WebAuthn dari request. `null` bila:
 * - header Origin tidak ada / tidak valid,
 * - Origin tidak sama dengan host tujuan (lihat `originAllowed`),
 * - bukan secure context (http selain localhost),
 * - host berupa alamat IP (WebAuthn menolak RP ID berupa IP).
 */
export function webAuthnOrigin(req: Request): WebAuthnOrigin | null {
  const raw = req.headers.get("origin");
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hosts = new Set<string>();
  const host = req.headers.get("host");
  if (host) hosts.add(host);
  const fwd = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwd) hosts.add(fwd);
  hosts.add(new URL(req.url).host);
  if (!hosts.has(url.host)) return null;

  const hostname = url.hostname;
  const isLocalhost = hostname === "localhost" || hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) return null;
  // IPv4 / IPv6 literal tidak boleh jadi RP ID.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) return null;
  return { origin: url.origin, rpId: hostname };
}

/**
 * Varian BACA-SAJA untuk request GET. Browser tidak mengirim header `Origin`
 * pada GET same-origin, jadi `webAuthnOrigin` selalu `null` di sini —
 * akibatnya lock screen tidak pernah melihat passkey. Untuk GET, origin
 * diturunkan dari host tujuan (`X-Forwarded-Host` / `Host`) + skema
 * (`X-Forwarded-Proto` / URL request), dengan aturan secure context & IP
 * yang sama.
 *
 * Hanya dipakai untuk info non-sensitif (jumlah passkey, label "bisa dipakai
 * di sini"). Langkah yang mengubah state / menerbitkan sesi (options,
 * register, login — semuanya POST) tetap wajib `webAuthnOrigin` yang ketat,
 * dan verifikasi WebAuthn sendiri mencocokkan origin yang ditandatangani
 * browser.
 */
export function webAuthnOriginForRead(req: Request): WebAuthnOrigin | null {
  if (req.headers.get("origin")) return webAuthnOrigin(req);
  const reqUrl = new URL(req.url);
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req.headers.get("host") ??
    reqUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    reqUrl.protocol.replace(/:$/, "");
  let url: URL;
  try {
    url = new URL(`${proto}://${host}`);
  } catch {
    return null;
  }
  const hostname = url.hostname;
  const isLocalhost = hostname === "localhost" || hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) return null;
  return { origin: url.origin, rpId: hostname };
}

/** Nama passkey bawaan dari user agent (bisa diganti user). */
export function defaultPasskeyName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `Passkey on ${os}` : "Passkey";
}

export function cleanPasskeyName(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length === 0 || clean.length > PASSKEY_NAME_MAX) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: memang menyaring kontrol
  if (/[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

// ------------------------------------------------------------- service ----

interface Challenge {
  kind: "register" | "login";
  challenge: string;
  rpId: string;
  origin: string;
  expiresAt: number;
}

export function createPasskeyService(opts: PasskeyServiceOptions): PasskeyService {
  const { store, auth } = opts;
  const now = opts.now ?? Date.now;
  const verifyReg = opts.verifyRegistration ?? verifyRegistrationResponse;
  const verifyAuth = opts.verifyAuthentication ?? verifyAuthenticationResponse;
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

  function putChallenge(c: Omit<Challenge, "expiresAt">): string {
    sweepChallenges();
    const id = randomUUID();
    challenges.set(id, { ...c, expiresAt: now() + CHALLENGE_TTL_MS });
    return id;
  }

  /** Ambil & HAPUS challenge (sekali pakai), pastikan jenis & asal sama. */
  function takeChallenge(
    id: unknown,
    kind: Challenge["kind"],
    origin: WebAuthnOrigin,
  ): Challenge | null {
    if (typeof id !== "string") return null;
    const c = challenges.get(id);
    challenges.delete(id);
    if (!c || c.kind !== kind || c.expiresAt <= now()) return null;
    if (c.rpId !== origin.rpId || c.origin !== origin.origin) return null;
    return c;
  }

  function toInfo(p: PasskeyRow, rpHere: string | null): PasskeyInfo {
    return {
      id: p.id,
      name: p.name,
      rpId: p.rpId,
      synced: p.backedUp || p.deviceType === "multiDevice",
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
      usableHere: rpHere !== null && p.rpId === rpHere,
    };
  }

  function availability(req: Request): PasskeyAvailability {
    // GET dari lock screen: browser tidak mengirim Origin (lihat
    // `webAuthnOriginForRead`).
    const o = webAuthnOriginForRead(req);
    if (!o || !auth.isProtected()) return { supported: o !== null, count: 0 };
    return { supported: true, count: store.listPasskeys(o.rpId).length };
  }

  function list(req: Request): PasskeyInfo[] {
    const rp = webAuthnOriginForRead(req)?.rpId ?? null;
    return store.listPasskeys().map((p) => toInfo(p, rp));
  }

  async function registrationOptions(req: Request, current: string, ip: string) {
    if (!auth.isProtected()) return { ok: false as const, error: "PASSKEY_LOCK_REQUIRED" };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false as const, error: "PASSKEY_UNSUPPORTED_ORIGIN" };
    if (store.listPasskeys().length >= PASSKEY_MAX) {
      return { ok: false as const, error: "PASSKEY_LIMIT" };
    }
    // Pendaftaran = mengubah cara buka kunci -> konfirmasi sandi saat ini.
    const check = await auth.internal.checkCurrentSecret(current, ip);
    if (!check.ok) return { ok: false as const, error: check.error ?? "CURRENT_SECRET_INVALID" };

    const existing = store.listPasskeys(o.rpId);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: o.rpId,
      userName: USER_NAME,
      userDisplayName: store.getAuthSettings(now()).nickname ?? RP_NAME,
      // Handle acak per pendaftaran: tidak ada identitas pengguna yang dibagi.
      userID: new Uint8Array(randomBytes(16)),
      timeout: CHALLENGE_TTL_MS,
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = putChallenge({
      kind: "register",
      challenge: options.challenge,
      rpId: o.rpId,
      origin: o.origin,
    });
    return { ok: true as const, data: { challengeId, options } };
  }

  async function register(
    req: Request,
    input: { challengeId: string; response: RegistrationResponseJSON; name?: string },
  ): Promise<Result<PasskeyInfo>> {
    if (!auth.isProtected()) return { ok: false, error: "PASSKEY_LOCK_REQUIRED" };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false, error: "PASSKEY_UNSUPPORTED_ORIGIN" };
    const c = takeChallenge(input.challengeId, "register", o);
    if (!c) return { ok: false, error: "PASSKEY_CHALLENGE_INVALID" };
    if (!input.response || typeof input.response !== "object") {
      return { ok: false, error: "PASSKEY_VERIFY_FAILED" };
    }
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyReg({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origin,
        expectedRPID: c.rpId,
        requireUserVerification: true,
      });
    } catch {
      return { ok: false, error: "PASSKEY_VERIFY_FAILED" };
    }
    if (!verified.verified) return { ok: false, error: "PASSKEY_VERIFY_FAILED" };
    const info = verified.registrationInfo;
    if (store.getPasskeyByCredentialId(info.credential.id)) {
      return { ok: false, error: "PASSKEY_ALREADY_REGISTERED" };
    }
    const name =
      (input.name !== undefined ? cleanPasskeyName(input.name) : null) ??
      defaultPasskeyName(req.headers.get("user-agent"));
    const row: PasskeyRow = {
      id: randomUUID(),
      credentialId: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      rpId: c.rpId,
      name,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      createdAt: now(),
      lastUsedAt: null,
    };
    store.insertPasskey(row);
    return { ok: true, data: toInfo(row, c.rpId) };
  }

  async function authenticationOptions(req: Request, ip: string) {
    if (!auth.isProtected()) return { ok: false as const, error: "AUTH_NOT_CONFIGURED" };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false as const, error: "PASSKEY_UNSUPPORTED_ORIGIN" };
    const wait = auth.internal.retryAfterSec(ip);
    if (wait > 0) return { ok: false as const, error: `AUTH_RATE_LIMITED:${wait}` };
    const creds = store.listPasskeys(o.rpId);
    if (creds.length === 0) return { ok: false as const, error: "PASSKEY_NONE" };
    const options = await generateAuthenticationOptions({
      rpID: o.rpId,
      timeout: CHALLENGE_TTL_MS,
      userVerification: "required",
      allowCredentials: creds.map((p) => ({ id: p.credentialId, transports: p.transports })),
    });
    const challengeId = putChallenge({
      kind: "login",
      challenge: options.challenge,
      rpId: o.rpId,
      origin: o.origin,
    });
    return { ok: true as const, data: { challengeId, options } };
  }

  async function login(
    req: Request,
    input: { challengeId: string; response: AuthenticationResponseJSON },
    ctx: LoginContext,
  ): Promise<Result<IssuedSession>> {
    if (!auth.isProtected()) return { ok: false, error: "AUTH_NOT_CONFIGURED" };
    const wait = auth.internal.retryAfterSec(ctx.ip);
    if (wait > 0) return { ok: false, error: `AUTH_RATE_LIMITED:${wait}` };
    const o = webAuthnOrigin(req);
    if (!o) return { ok: false, error: "PASSKEY_UNSUPPORTED_ORIGIN" };

    const fail = (): Result<IssuedSession> => {
      auth.internal.recordFailure(ctx.ip);
      const next = auth.internal.retryAfterSec(ctx.ip);
      return { ok: false, error: next > 0 ? `AUTH_RATE_LIMITED:${next}` : "PASSKEY_INVALID" };
    };

    const c = takeChallenge(input.challengeId, "login", o);
    if (!c) return { ok: false, error: "PASSKEY_CHALLENGE_INVALID" };
    const credId = input.response && typeof input.response.id === "string" ? input.response.id : "";
    const cred = store.getPasskeyByCredentialId(credId);
    // Passkey milik domain lain tidak boleh dipakai di sini.
    if (!cred || cred.rpId !== c.rpId) return fail();

    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuth({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origin,
        expectedRPID: c.rpId,
        credential: {
          id: cred.credentialId,
          // Salin ke ArrayBuffer biasa (tipe `Uint8Array_` milik library).
          publicKey: new Uint8Array(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports,
        },
        requireUserVerification: true,
      });
    } catch {
      return fail();
    }
    if (!verified.verified) return fail();
    auth.internal.recordSuccess(ctx.ip);
    store.markPasskeyUsed(cred.id, verified.authenticationInfo.newCounter, now());
    return { ok: true, data: auth.internal.issueSession(ctx) };
  }

  function rename(id: string, name: string): Result<PasskeyInfo> {
    const p = store.getPasskeyById(id);
    if (!p) return { ok: false, error: "PASSKEY_NOT_FOUND" };
    const clean = typeof name === "string" ? cleanPasskeyName(name) : null;
    if (!clean) return { ok: false, error: "PASSKEY_NAME_INVALID" };
    store.renamePasskey(id, clean);
    return { ok: true, data: toInfo({ ...p, name: clean }, null) };
  }

  function remove(id: string): Result<null> {
    if (!store.getPasskeyById(id)) return { ok: false, error: "PASSKEY_NOT_FOUND" };
    store.deletePasskey(id);
    return { ok: true, data: null };
  }

  return {
    availability,
    list,
    registrationOptions,
    register,
    authenticationOptions,
    login,
    rename,
    remove,
  };
}
