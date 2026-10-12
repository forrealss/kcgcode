/**
 * Pemilihan port HTTP saat startup.
 *
 * Prioritas: `--port` > `KCG_PORT` > `port` di config > 3000.
 * Port eksplisit (flag/env) yang terpakai → error; port dari config/default
 * yang terpakai → otomatis pindah ke port kosong berikutnya.
 */

export const DEFAULT_PORT = 3000;
/** Jumlah port berurutan yang dicoba saat fallback. */
const SCAN_ATTEMPTS = 50;

export type PortSource = "flag" | "env" | "config" | "default";

const CONNECT_TIMEOUT_MS = 1000;

/** true bila ada yang sudah listen (koneksi TCP diterima). */
async function acceptsConnection(hostname: string, port: number): Promise<boolean> {
  // Alamat wildcard tidak bisa dituju — cek lewat loopback.
  const host = hostname === "0.0.0.0" ? "127.0.0.1" : hostname === "::" ? "::1" : hostname;
  const attempt = Bun.connect({
    hostname: host,
    port,
    socket: { data() {}, open: (s) => void s.end() },
  }).then(
    (s) => {
      s.end();
      return true;
    },
    () => false,
  );
  const timeout = Bun.sleep(CONNECT_TIMEOUT_MS).then(() => false);
  return Promise.race([attempt, timeout]);
}

/**
 * Cek port bisa dipakai. Probe bind saja tidak cukup: setelah server kcgcode
 * berjalan di proses ini, bind ke port yang sudah dipakai proses lain bisa
 * "berhasil" (SO_REUSEPORT). Jadi cek koneksi TCP dulu, lalu probe bind untuk
 * port yang terpakai tapi tidak menerima koneksi (mis. butuh root).
 */
export async function portIsFree(hostname: string, port: number): Promise<boolean> {
  if (port === 0) return true;
  if (await acceptsConnection(hostname, port)) return false;
  try {
    const probe = Bun.serve({ hostname, port, reusePort: false, fetch: () => new Response() });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Port yang diminta beserta asalnya. `envPort` dibaca sebelum override `--port`. */
export function requestedPort(opts: { flag?: number; env?: string; config?: number }): {
  port: number;
  source: PortSource;
} {
  if (opts.flag !== undefined) return { port: opts.flag, source: "flag" };
  if (opts.env !== undefined && opts.env.trim() !== "") {
    const n = Number(opts.env);
    if (Number.isInteger(n) && n > 0 && n <= 65535) return { port: n, source: "env" };
  }
  if (opts.config !== undefined) return { port: opts.config, source: "config" };
  return { port: DEFAULT_PORT, source: "default" };
}

export type PortChoice =
  | { ok: true; port: number; fallbackFrom: number | null }
  | { ok: false; error: string };

/** Pilih port final: pakai yang diminta, atau cari pengganti bila boleh. */
export async function choosePort(
  hostname: string,
  req: { port: number; source: PortSource },
  isFree: (hostname: string, port: number) => boolean | Promise<boolean> = portIsFree,
): Promise<PortChoice> {
  if (await isFree(hostname, req.port)) return { ok: true, port: req.port, fallbackFrom: null };

  if (req.source === "flag" || req.source === "env") {
    const via = req.source === "flag" ? "--port" : "KCG_PORT";
    return { ok: false, error: `Port ${req.port} (from ${via}) is already in use on ${hostname}.` };
  }

  for (let p = req.port + 1; p < req.port + 1 + SCAN_ATTEMPTS && p <= 65535; p++) {
    if (await isFree(hostname, p)) return { ok: true, port: p, fallbackFrom: req.port };
  }
  return {
    ok: false,
    error: `Port ${req.port} and the next ${SCAN_ATTEMPTS} ports are in use on ${hostname}.`,
  };
}
