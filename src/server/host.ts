/**
 * Alamat bind server. Default loopback `127.0.0.1` sehingga hanya dapat
 * diakses dari mesin ini; ubah lewat `KCG_HOST` (atau `--host` di CLI).
 *
 * Catatan: server tidak memakai otentikasi. Bind ke `0.0.0.0` membuat
 * siapa pun di jaringan yang sama dapat mengontrol agent di mesin ini.
 */
export const DEFAULT_HOSTNAME = "127.0.0.1";

export function resolveHostname(env: Record<string, string | undefined> = process.env): string {
  return env.KCG_HOST ?? DEFAULT_HOSTNAME;
}
