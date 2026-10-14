/**
 * Deteksi versi CLI `opencode` milik user.
 *
 * KCG Code hanya mendukung opencode v2 (API & event yang menjadi acuan lapisan
 * agent). v1 tidak lagi didukung: `opencode serve` v1 memakai API yang sama
 * sekali berbeda, jadi user diminta upgrade alih-alih dibungkus.
 */
import type { Result } from "../../result";

/** Mayor minimum yang didukung. */
export const OPENCODE_MIN_MAJOR = 2;

/** CLI `opencode` tidak ditemukan di PATH. */
export const OPENCODE_NOT_FOUND = "OPENCODE_NOT_FOUND";
/** CLI `opencode` terpasang tapi versi < 2 — user perlu upgrade. */
export const OPENCODE_UPGRADE_REQUIRED = "OPENCODE_UPGRADE_REQUIRED";

export interface OpencodeVersion {
  /** Versi lengkap, mis. `2.0.28`. */
  version: string;
  major: number;
}

/** Ambil versi dari output `opencode --version` (`opencode v2.0.28` / `1.4.3`). */
export function parseOpencodeVersion(output: string): OpencodeVersion | null {
  const m = output.match(/(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?/);
  if (!m) return null;
  return { version: m[0], major: Number(m[1]) };
}

/** Jalankan `opencode --version` (injectable untuk test). */
export type VersionProbe = () => Promise<
  { ok: true; output: string } | { ok: false; notFound: boolean; error: string }
>;

export const defaultVersionProbe: VersionProbe = async () => {
  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      windowsHide: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 15_000);
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: true, output: `${out}\n${err}` };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return { ok: false, notFound: /ENOENT|not found|executable/i.test(msg), error: msg };
  }
};

/**
 * Pastikan opencode terpasang dan versinya didukung. Error:
 * `OPENCODE_NOT_FOUND`, `OPENCODE_UPGRADE_REQUIRED: <versi>`, atau
 * `SERVER_START_FAILED: …` bila versi tidak terbaca.
 */
export async function checkOpencodeVersion(
  probe: VersionProbe = defaultVersionProbe,
): Promise<Result<OpencodeVersion>> {
  const res = await probe();
  if (!res.ok) {
    return {
      ok: false,
      error: res.notFound ? OPENCODE_NOT_FOUND : `SERVER_START_FAILED: ${res.error}`,
    };
  }
  const v = parseOpencodeVersion(res.output);
  if (!v) return { ok: false, error: "SERVER_START_FAILED: unable to read the opencode version" };
  if (v.major < OPENCODE_MIN_MAJOR) {
    return { ok: false, error: `${OPENCODE_UPGRADE_REQUIRED}: ${v.version}` };
  }
  return { ok: true, data: v };
}
