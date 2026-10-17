/**
 * Baca satu file Project untuk viewer (baca-saja).
 *
 * Batas keamanan: path harus tetap di dalam folder Project setelah symlink
 * di-resolve, tidak menyentuh `.git`, dan tidak berada di folder data /
 * config kcgcode (hash sandi, token tunnel). Teks dibatasi ukurannya; gambar
 * disajikan mentah (route memberi CSP sandbox untuk SVG).
 */

import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectFileContent } from "../../types";
import type { Result } from "../result";

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Path absolut file Project yang boleh dibaca, atau error. */
export function resolveProjectFile(
  projectRoot: string,
  relPath: string,
  protectedDirs: string[],
): Result<string> {
  if (!relPath || relPath.includes("\0")) return { ok: false, error: "FILE_NOT_FOUND" };
  const target = path.resolve(projectRoot, relPath);
  if (!inside(projectRoot, target)) return { ok: false, error: "PATH_OUTSIDE_PROJECT" };
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(target);
    realRoot = realpathSync(projectRoot);
  } catch {
    return { ok: false, error: "FILE_NOT_FOUND" };
  }
  if (!inside(realRoot, real)) return { ok: false, error: "PATH_OUTSIDE_PROJECT" };
  if (path.relative(realRoot, real).split(path.sep).includes(".git")) {
    return { ok: false, error: "PATH_OUTSIDE_PROJECT" };
  }
  for (const dir of protectedDirs) {
    let realDir = dir;
    try {
      realDir = realpathSync(dir);
    } catch {
      // folder belum ada — bandingkan apa adanya
    }
    if (inside(realDir, real)) return { ok: false, error: "PATH_OUTSIDE_PROJECT" };
  }
  try {
    if (!statSync(real).isFile()) return { ok: false, error: "FILE_NOT_FOUND" };
  } catch {
    return { ok: false, error: "FILE_NOT_FOUND" };
  }
  return { ok: true, data: real };
}

function readHead(file: string, bytes: number): Uint8Array<ArrayBuffer> {
  const fd = openSync(file, "r");
  try {
    const buf = new Uint8Array(new ArrayBuffer(bytes));
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export function readProjectFile(
  projectRoot: string,
  relPath: string,
  protectedDirs: string[],
): Result<ProjectFileContent> {
  const resolved = resolveProjectFile(projectRoot, relPath, protectedDirs);
  if (!resolved.ok) return resolved;
  const file = resolved.data;
  const size = statSync(file).size;
  const rel = path.relative(realpathSync(projectRoot), file).split(path.sep).join("/");
  if (IMAGE_TYPES[path.extname(file).toLowerCase()]) {
    return { ok: true, data: { path: rel, size, kind: "image", content: null, truncated: false } };
  }
  const head = readHead(file, Math.min(size, MAX_TEXT_BYTES));
  // Byte NUL di awal = biner.
  if (head.subarray(0, 8000).includes(0)) {
    return { ok: true, data: { path: rel, size, kind: "binary", content: null, truncated: false } };
  }
  return {
    ok: true,
    data: {
      path: rel,
      size,
      kind: "text",
      content: new TextDecoder().decode(head),
      truncated: size > MAX_TEXT_BYTES,
    },
  };
}

/** Bytes gambar Project + MIME (untuk `<img>`), atau error. */
export function readProjectImage(
  projectRoot: string,
  relPath: string,
  protectedDirs: string[],
): Result<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const resolved = resolveProjectFile(projectRoot, relPath, protectedDirs);
  if (!resolved.ok) return resolved;
  const mime = IMAGE_TYPES[path.extname(resolved.data).toLowerCase()];
  if (!mime) return { ok: false, error: "UNSUPPORTED_TYPE" };
  const size = statSync(resolved.data).size;
  if (size > MAX_IMAGE_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };
  return { ok: true, data: { bytes: readHead(resolved.data, size), mime } };
}
