/**
 * Kontrak publik & konstanta passkey (WebAuthn): batas, umur challenge,
 * identitas RP, serta tipe yang dipakai route & browser.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { SessionStore } from "../../../../db";
import type { Result } from "../../../result";
import type { AuthService, IssuedSession, LoginContext } from "../types";

export const PASSKEY_NAME_MAX = 60;
export const PASSKEY_MAX = 20;
/** Umur challenge (ms). Sama dengan timeout WebAuthn yang dikirim ke browser. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const RP_NAME = "KCG Code";
/** User handle tetap — app satu pemilik, tidak ada akun. */
export const USER_NAME = "kcgcode-owner";

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
