/**
 * Validator Sandbox_Root — `resolveWithinSandbox`.
 * Sesuai `design.md` — `sandbox.ts`.
 *
 * Langkah validasi:
 * 1. Tolak segmen path yang berisi `..` sebelum resolusi apa pun.
 * 2. Validasi karakter terlarang OS pada tiap segmen nama direktori.
 * 3. Resolve path (mengikuti symlink) lalu pastikan hasil berada di dalam
 *    `sandboxRoot` (startsWith `rootReal + sep` atau sama persis).
 *
 * Path yang belum ada di filesystem (mis. saat `createProject` akan mkdir)
 * tetap diperbolehkan selama seluruh segmen valid dan ancestor terdalam yang
 * sudah ada berada di dalam sandbox.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export type SandboxReason = "outside_sandbox" | "invalid_chars";

export type SandboxResult = { ok: true; realPath: string } | { ok: false; reason: SandboxReason };

/** Karakter terlarang untuk nama direktori sesuai OS server. */
const FORBIDDEN_CHARS = process.platform === "win32" ? /[<>:"|?*\0/\\]/ : /[\0]/;

function isWithin(rootReal: string, p: string): boolean {
  return p === rootReal || p.startsWith(rootReal + path.sep);
}

function splitSegments(userPath: string): string[] {
  return userPath.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
}

/**
 * Memvalidasi dan me-resolve `userPath` terhadap `sandboxRoot`.
 * Mengembalikan path absolut hasil resolusi bila valid.
 */
export function resolveWithinSandbox(sandboxRoot: string, userPath: string): SandboxResult {
  let rootReal: string;
  try {
    rootReal = realpathSync(sandboxRoot);
  } catch {
    return { ok: false, reason: "outside_sandbox" };
  }

  const segments = splitSegments(userPath);

  // 1. Tolak ".." sebelum resolusi apa pun
  // 2. Validasi karakter terlarang OS
  for (const seg of segments) {
    if (seg === "..") return { ok: false, reason: "outside_sandbox" };
    if (FORBIDDEN_CHARS.test(seg)) return { ok: false, reason: "invalid_chars" };
  }

  // 3. Gabungkan + resolve, mengikuti symlink.
  //    Path absolut dipakai langsung (bukan digabung) sehingga path absolut di
  //    luar sandbox pasti tertolak oleh pemeriksaan kontainmen.
  const candidate = path.isAbsolute(userPath)
    ? path.normalize(userPath)
    : path.join(rootReal, ...segments);

  // Cari ancestor terdalam yang sudah ada di filesystem agar `realpath`
  // (yang mengikuti symlink) dapat dijalankan meski path tujuan belum dibuat.
  let existing = candidate;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return { ok: false, reason: "outside_sandbox" };
    tail.unshift(path.basename(existing));
    existing = parent;
  }

  let realExisting: string;
  try {
    realExisting = realpathSync(existing);
  } catch {
    return { ok: false, reason: "outside_sandbox" };
  }

  if (!isWithin(rootReal, realExisting)) return { ok: false, reason: "outside_sandbox" };

  const realPath = tail.length === 0 ? realExisting : path.join(realExisting, ...tail);
  return { ok: true, realPath };
}
