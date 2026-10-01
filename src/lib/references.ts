/**
 * Daftar "Reference": file project yang DIBACA agent untuk menjawab.
 *
 * Diturunkan dari parts pesan yang SUDAH dimiliki timeline (tidak ada request
 * tambahan): tiap pembacaan file dikumpulkan tanpa duplikat, TERBARU DI ATAS.
 *
 * "Terbaru" = pembacaan terakhir, bukan pertama: file yang dibaca lagi naik
 * kembali ke atas. Jadi bagian atas daftar selalu mencerminkan apa yang
 * sedang dikerjakan agent saat ini.
 *
 * Yang dihitung "dibaca":
 * - Tool `read` dengan target satu file.
 * - Referensi `@file` dari pengguna (part `file` TANPA `attachmentId`) — isi
 *   file itu dibaca untuk menjawab.
 *
 * Yang TIDAK dihitung:
 * - Tool penulis (`write`, `edit`, `patch`, …). Reference menjawab "konteks
 *   apa yang dipakai agent", bukan "apa yang diubah". File yang dibaca lalu
 *   diubah tetap muncul — karena ia DIBACA; file yang hanya ditulis tidak.
 * - `bash`, `grep`, `glob`, `list`, `webfetch`, dll — targetnya pola/perintah,
 *   bukan satu file.
 * - Lampiran upload pengguna (part `file` dengan `attachmentId`): sudah tampil
 *   di bubble pesannya sendiri dan bukan file project.
 * - Path di luar project, direktori (berakhiran `/`), dan pola glob.
 */
import type { MessagePart, SessionMessage } from "@/types";
import { toolTarget } from "./turns";

/** Tool yang membaca isi satu file. */
const READ_TOOLS = new Set(["read"]);

export interface FileReference {
  /** Path relatif terhadap root project. */
  path: string;
}

/** Nama file terakhir dari sebuah path (untuk tampilan ringkas). */
export function baseName(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

/** Path tampak seperti pola glob / direktori, bukan satu file. */
function isPatternOrDir(p: string): boolean {
  return p.endsWith("/") || /[*?{}[\]]/.test(p);
}

/**
 * Normalisasi target tool menjadi path relatif project, atau null bila bukan
 * file project (di luar `cwd`, glob, direktori, kosong).
 */
export function toProjectPath(target: string, cwd: string | null): string | null {
  const raw = target.trim();
  if (raw === "" || isPatternOrDir(raw)) return null;

  let rel = raw;
  if (raw.startsWith("/")) {
    // Absolut: hanya diterima bila berada di dalam worktree project.
    if (cwd === null || cwd === "") return null;
    const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
    if (!raw.startsWith(base)) return null;
    rel = raw.slice(base.length);
  }
  rel = rel.replace(/^\.\//, "");
  // `..` keluar dari project -> bukan file project.
  if (rel === "" || rel.startsWith("../")) return null;
  return rel;
}

/**
 * Kumpulkan file yang dibaca di seluruh pesan satu Session, terbaru di atas.
 * `cwd` dipakai untuk mengubah path absolut menjadi relatif; null -> path
 * absolut diabaikan.
 */
export function collectReferences(
  messages: readonly SessionMessage[],
  cwd: string | null = null,
): FileReference[] {
  // Map mempertahankan urutan sisip: hapus lalu sisip ulang = pindahkan ke
  // akhir. Setelah selesai, akhir Map = pembacaan paling baru -> dibalik.
  const byRecency = new Map<string, FileReference>();
  for (const message of messages) {
    for (const part of message.parts) {
      const path = readPath(part, cwd);
      if (path === null) continue;
      byRecency.delete(path);
      byRecency.set(path, { path });
    }
  }
  return [...byRecency.values()].reverse();
}

/** Path file project yang DIBACA oleh satu part, atau null. */
function readPath(part: MessagePart, cwd: string | null): string | null {
  // Echo `@file` dari pengguna: part `file` tanpa `attachmentId` (lampiran
  // upload selalu punya `attachmentId` dan bukan file project).
  if (part.type === "file") {
    if (typeof part.attachmentId === "string") return null;
    const name = typeof part.filename === "string" ? part.filename : "";
    return toProjectPath(name, cwd);
  }
  if (part.type !== "tool") return null;
  const tool = typeof part.tool === "string" ? part.tool.toLowerCase() : "";
  if (!READ_TOOLS.has(tool)) return null;
  const target = toolTarget(part);
  return target === null ? null : toProjectPath(target, cwd);
}
