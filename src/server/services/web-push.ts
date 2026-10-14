/**
 * Web Push tanpa dependency — hanya Web Crypto bawaan Bun + `fetch`.
 *
 * - VAPID (RFC 8292): JWT ES256 `Authorization: vapid t=<jwt>, k=<public>`.
 *   Kunci P-256 dibuat sekali lalu disimpan di DB (`push_settings`).
 * - Enkripsi payload `aes128gcm` (RFC 8291 + RFC 8188): ECDH dengan kunci
 *   `p256dh` browser, HKDF dengan `auth` secret, satu record AES-128-GCM.
 *   Diuji terhadap test vector Appendix A RFC 8291.
 *
 * Server push (FCM, Mozilla autopush, Apple, WNS) hanya menerima koneksi
 * keluar dari mesin ini — tidak ada port yang perlu dibuka.
 */

export interface PushKeys {
  /** Kunci publik P-256 browser (uncompressed, base64url). */
  p256dh: string;
  /** Auth secret 16 byte (base64url). */
  auth: string;
}

export interface PushTarget {
  endpoint: string;
  keys: PushKeys;
}

export interface VapidKeys {
  /** Kunci publik uncompressed (65 byte) base64url — dipakai browser sebagai `applicationServerKey`. */
  publicKey: string;
  /** Kunci privat sebagai JWK (JSON string) — tidak pernah dikirim ke browser. */
  privateJwk: string;
}

export type PushResult =
  | { ok: true; status: number }
  /** `gone`: subscription sudah tidak berlaku (404/410) — hapus dari DB. */
  | { ok: false; status: number; gone: boolean; reason: string };

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

/** Byte di atas ArrayBuffer biasa (Web Crypto menolak SharedArrayBuffer). */
type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(u8).toString("base64url");
}

export function b64urlDecode(s: string): Bytes {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Validasi subscription dari browser
// ---------------------------------------------------------------------------

/** Kunci `p256dh` valid: titik P-256 uncompressed (65 byte, diawali 0x04). */
export function isValidP256dh(s: string): boolean {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return false;
  const b = b64urlDecode(s);
  return b.length === 65 && b[0] === 0x04;
}

/** Auth secret valid: 16 byte. */
export function isValidAuthSecret(s: string): boolean {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return false;
  return b64urlDecode(s).length === 16;
}

/** Endpoint push harus URL HTTPS (semua layanan push browser memakai HTTPS). */
export function isValidEndpoint(s: string): boolean {
  if (s.length > 2048) return false;
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// VAPID
// ---------------------------------------------------------------------------

/** Buat pasangan kunci VAPID baru (dipanggil sekali, lalu disimpan). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk: JSON.stringify(jwk) };
}

/**
 * JWT VAPID untuk satu origin layanan push. `sub` wajib URL atau `mailto:`
 * yang valid — Apple menolak (`BadJwtToken`) placeholder seperti
 * `mailto:x@localhost`.
 */
export async function createVapidJwt(
  audience: string,
  subject: string,
  privateJwk: string,
  expSec: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(privateJwk) as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: audience, exp: expSec, sub: subject })),
  );
  const unsigned = `${header}.${claims}`;
  // Web Crypto menghasilkan tanda tangan r||s (IEEE P1363) — format yang
  // memang dipakai JWS ES256, tanpa konversi DER.
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(unsigned),
  );
  return `${unsigned}.${b64urlEncode(sig)}`;
}

// ---------------------------------------------------------------------------
// aes128gcm (RFC 8291)
// ---------------------------------------------------------------------------

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Kunci ECDH sementara milik server (diinjeksi test untuk test vector). */
export interface LocalEcdhKey {
  publicRaw: Bytes;
  privateKey: CryptoKey;
}

async function generateLocalKey(): Promise<LocalEcdhKey> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicRaw, privateKey: pair.privateKey };
}

/**
 * Enkripsi payload untuk satu subscription (`Content-Encoding: aes128gcm`).
 * Hasil = header (salt | rs | idlen | keyid) + satu record terenkripsi.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  keys: PushKeys,
  opts: { salt?: Bytes; localKey?: LocalEcdhKey } = {},
): Promise<Bytes> {
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const local = opts.localKey ?? (await generateLocalKey());

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256),
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, local.publicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // Satu record: plaintext || 0x02 (delimiter record terakhir), tanpa padding.
  const record = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record),
  );

  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + local.publicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = local.publicRaw.length;
  header.set(local.publicRaw, 21);
  return concat(header, ciphertext);
}

// ---------------------------------------------------------------------------
// Kirim
// ---------------------------------------------------------------------------

/** Ukuran payload maksimum yang aman untuk semua layanan push (4 KB record). */
export const MAX_PAYLOAD_BYTES = 3000;

export interface SendPushOptions {
  vapid: VapidKeys;
  /** Klaim `sub` VAPID: URL atau `mailto:` yang valid. */
  subject: string;
  /** Lama pesan disimpan layanan push bila perangkat offline (detik). */
  ttlSec: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  fetchFn?: typeof fetch;
  nowSec?: () => number;
}

/** Kirim satu pesan push terenkripsi ke satu subscription. */
export async function sendPush(
  target: PushTarget,
  payload: string,
  opts: SendPushOptions,
): Promise<PushResult> {
  const data = enc.encode(payload);
  if (data.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, status: 0, gone: false, reason: "PAYLOAD_TOO_LARGE" };
  }
  const audience = new URL(target.endpoint).origin;
  const now = opts.nowSec?.() ?? Math.floor(Date.now() / 1000);
  const jwt = await createVapidJwt(audience, opts.subject, opts.vapid.privateJwk, now + 12 * 3600);
  const body = await encryptPayload(data, target.keys);
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const res = await fetchFn(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt}, k=${opts.vapid.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttlSec),
        Urgency: opts.urgency ?? "normal",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    const reason = (await res.text().catch(() => "")).slice(0, 200);
    return {
      ok: false,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
      reason,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      gone: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
