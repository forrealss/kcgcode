/**
 * Turunkan origin & RP ID WebAuthn dari request — selalu dari header
 * (`Origin` / host tujuan), tidak pernah dari input body. Hanya secure
 * context (https, atau http://localhost) dan host non-IP yang diterima.
 */
import type { WebAuthnOrigin } from "./types";

/**
 * Aturan secure context & IP yang sama untuk kedua varian: `null` bila
 * bukan https (selain http://localhost) atau host berupa alamat IP.
 */
function secureOrigin(url: URL): WebAuthnOrigin | null {
  const hostname = url.hostname;
  const isLocalhost = hostname === "localhost" || hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) return null;
  // IPv4 / IPv6 literal tidak boleh jadi RP ID.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) return null;
  return { origin: url.origin, rpId: hostname };
}

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

  return secureOrigin(url);
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
  return secureOrigin(url);
}
