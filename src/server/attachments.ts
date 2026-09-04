/**
 * Attachment_Store — penyimpanan gambar yang di-upload Client untuk Session.
 *
 * Gambar dikirim dari browser ke KCG Bridge (HTTP), disimpan di disk sebagai
 * file tak ternama (`<uuid>` di `<uploadsRoot>/<sessionId>/`), lalu dirujuk
 * oleh Session sebagai part `file` dengan `mime: image/*` + `url: file:///…`
 * saat prompt dikirim ke opencode (lihat `opencode-client.ts`).
 *
 * - Hanya PNG/JPEG/GIF/WebP yang diterima (format gambar yang didukung
 *   opencode sebagai image media; SVG diperlakukan teks, bukan gambar).
 * - Batas 20 MiB per file (mengikuti batas attachment opencode).
 * - File disimpan per-Session agar mudah dibersihkan saat Session dihapus
 *   (`removeSession`) dan tidak tercampur antar Session/Project.
 * - `id` adalah UUID acak yang dibangkitkan server — path upload tidak pernah
 *   menerima masukan pengguna, sehingga aman dari path traversal.
 * - Metadata (nama asli + mime) disimpan sebagai sidecar JSON per file agar
 *   echo pesan & part file tetap membawa nama tampilan asli pengguna.
 *
 * Dipakai oleh:
 * - `app.ts` (route HTTP upload + serve),
 * - `session-manager.ts` (resolve upload id -> file URL absolut saat kirim
 *   prompt & membersihkan file saat Session dihapus).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Result } from "./types";

/** Batas ukuran upload (byte) — mengikuti limit attachment opencode (20 MiB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Format gambar yang diterima sebagai image media oleh opencode. */
const SUPPORTED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isSupportedImageMime(mime: string): boolean {
  return SUPPORTED_IMAGE_MIME.has(mime);
}

export interface AttachmentMeta {
  /** Id lampiran (UUID acak, dibangkitkan server). */
  id: string;
  /** Nama file asli dari perangkat pengguna (untuk tampilan). */
  filename: string;
  /** MIME image (image/png, image/jpeg, dst). */
  mime: string;
  size: number;
}

export interface AttachmentManager {
  /**
   * Simpan bytes gambar ke penyimpanan Session. Memvalidasi mime & ukuran;
   * mengembalikan metadata lampiran (termasuk `id` untuk rujukan berikutnya).
   */
  save(
    sessionId: string,
    filename: string,
    mime: string,
    bytes: Uint8Array,
  ): Result<AttachmentMeta>;
  /** Baca metadata + path absolut file lampiran (untuk part `file` opencode). */
  info(sessionId: string, id: string): Result<AttachmentMeta & { absPath: string }>;
  /** Baca bytes file lampiran (untuk route serve gambar ke browser). */
  read(
    sessionId: string,
    id: string,
  ): Result<{ bytes: Uint8Array; mime: string; filename: string }>;
  /** Hapus satu lampiran (mis. pengguna membatalkan sebelum mengirim). */
  remove(sessionId: string, id: string): void;
  /** Hapus seluruh lampiran milik Session (saat Session dihapus permanen). */
  removeSession(sessionId: string): void;
}

/** Id lampiran valid: UUID tanpa karakter path (`-` di dalamnya aman). */
function isValidId(id: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(id);
}

/**
 * Path aman untuk file bytes di bawah direktori Session; mengembalikan null
 * bila `id` bukan UUID (mencegah traversal).
 */
function safeIdPath(dir: string, id: string): string | null {
  if (!isValidId(id)) return null;
  return path.join(dir, id);
}

/** Path aman sidecar metadata `<id>.meta.json` (id UUID tervalidasi). */
function safeMetaPath(dir: string, id: string): string | null {
  if (!isValidId(id)) return null;
  return path.join(dir, `${id}.meta.json`);
}

function errResult(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

/** Buat direktori Session (bila belum ada). */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function readMeta(
  dir: string,
  id: string,
): { filename: string; mime: string; size: number } | null {
  const metaPath = safeMetaPath(dir, id);
  if (!metaPath) return null;
  try {
    const raw = JSON.parse(readFileSync(metaPath, "utf8")) as {
      filename?: unknown;
      mime?: unknown;
      size?: unknown;
    };
    if (typeof raw.filename !== "string" || typeof raw.mime !== "string") return null;
    return {
      filename: raw.filename,
      mime: raw.mime,
      size: typeof raw.size === "number" ? raw.size : 0,
    };
  } catch {
    return null;
  }
}

export function createAttachmentManager(uploadsRoot: string): AttachmentManager {
  return {
    save(sessionId, filename, mime, bytes) {
      if (!isSupportedImageMime(mime)) return errResult("UNSUPPORTED_IMAGE_MIME");
      if (bytes.byteLength === 0) return errResult("EMPTY_UPLOAD");
      if (bytes.byteLength > MAX_UPLOAD_BYTES) return errResult("IMAGE_TOO_LARGE");

      const dir = path.join(uploadsRoot, sessionId);
      ensureDir(dir);
      const id = randomUUID();
      try {
        writeFileSync(safeIdPath(dir, id) as string, bytes);
        writeFileSync(
          safeMetaPath(dir, id) as string,
          JSON.stringify({ filename, mime, size: bytes.byteLength }),
        );
      } catch (e) {
        return errResult(`UPLOAD_WRITE_FAILED: ${(e as Error).message}`);
      }
      return { ok: true, data: { id, filename, mime, size: bytes.byteLength } };
    },

    info(sessionId, id) {
      const dir = path.join(uploadsRoot, sessionId);
      const filePath = safeIdPath(dir, id);
      if (!filePath) return errResult("ATTACHMENT_NOT_FOUND");
      const meta = readMeta(dir, id);
      if (!meta) return errResult("ATTACHMENT_NOT_FOUND");
      // `absPath` wajib absolut: dipakai untuk URL `file:///…` yang dikirim
      // ke opencode — `file://rel/path` (host=rel) ditolak opencode ("File
      // URL host must be localhost or empty") dan prompt gagal diam-diam.
      return { ok: true, data: { ...meta, id, absPath: path.resolve(filePath) } };
    },

    read(sessionId, id) {
      const dir = path.join(uploadsRoot, sessionId);
      const filePath = safeIdPath(dir, id);
      if (!filePath) return errResult("ATTACHMENT_NOT_FOUND");
      const meta = readMeta(dir, id);
      if (!meta) return errResult("ATTACHMENT_NOT_FOUND");
      try {
        return {
          ok: true,
          data: { bytes: readFileSync(filePath), mime: meta.mime, filename: meta.filename },
        };
      } catch {
        return errResult("ATTACHMENT_NOT_FOUND");
      }
    },

    remove(sessionId, id) {
      const dir = path.join(uploadsRoot, sessionId);
      const filePath = safeIdPath(dir, id);
      if (filePath) rmSync(filePath, { force: true });
      const metaPath = safeMetaPath(dir, id);
      if (metaPath) rmSync(metaPath, { force: true });
    },

    removeSession(sessionId) {
      rmSync(path.join(uploadsRoot, sessionId), { recursive: true, force: true });
    },
  };
}
