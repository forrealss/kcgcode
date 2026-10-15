/**
 * Input bebas user -> echo pesan (part tampilan) + payload prompt agent.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { modelFacingMime } from "../../../lib/attachments";
import type { MessagePart } from "../../../types";
import type { AgentPromptFile } from "../../agents/types";
import { MAX_FREE_TEXT_LENGTH } from "./types";

/** Lampiran upload yang sudah di-resolve dari Attachment_Store. */
export interface ResolvedAttachment {
  id: string;
  filename: string;
  mime: string;
  absPath: string;
}

export interface PromptInput {
  /** Part pesan user yang disimpan & di-echo ke Client. */
  userParts: MessagePart[];
  /** File yang dikirim ke model (referensi `@file` + lampiran yang didukung). */
  promptFiles: AgentPromptFile[];
  /** Teks prompt ke agent (teks user + rujukan path lampiran biner). */
  promptText: string;
}

/**
 * Pesan berupa teks bebas dan/atau gambar: teks kosong diizinkan bila ada
 * gambar terlampir (mis. kirim gambar saja), selainnya wajib non-kosong.
 * Mengembalikan kode error, atau null bila valid.
 */
export function validateFreeText(text: string, hasImages: boolean): string | null {
  const hasText = text.trim().length > 0;
  if (!hasText && !hasImages) return "TEXT_EMPTY";
  if (hasText && text.length > MAX_FREE_TEXT_LENGTH) return "TEXT_TOO_LONG";
  return null;
}

/**
 * Referensi @file di-echo sebagai part `file` mime text/plain; gambar upload
 * sebagai part `file` mime image/* dengan `attachmentId` agar renderer dapat
 * memuat bytes lewat HTTP. Path relatif project diubah ke file URL absolut
 * (`file:///abs/path`, host kosong) — `pathToFileURL` juga benar untuk path
 * Windows (`file:///D:/…`) dan meng-escape `#`/`?`/spasi.
 */
export function buildPromptInput(
  cwd: string,
  text: string,
  files: string[],
  attachments: ResolvedAttachment[],
): PromptInput {
  const promptFiles: AgentPromptFile[] = [];
  const userParts: MessagePart[] = [{ type: "text", text }];
  for (const filename of files) {
    const url = pathToFileURL(path.resolve(cwd, filename)).href;
    userParts.push({ type: "file", mime: "text/plain", filename, url });
    promptFiles.push({ uri: url, name: filename, mime: "text/plain" });
  }
  /** Lampiran biner (zip, audio, …): tidak dikirim sebagai part. */
  const pathOnly: { filename: string; absPath: string }[] = [];
  for (const info of attachments) {
    // Jaring pengaman: `file://` harus menunjuk path absolut (host kosong).
    const url = pathToFileURL(path.resolve(info.absPath)).href;
    // Echo selalu memakai mime asli (renderer memilih thumbnail / kartu).
    userParts.push({
      type: "file",
      mime: info.mime,
      filename: info.filename,
      url,
      attachmentId: info.id,
    });
    // Ke model: hanya mime yang diterima provider (gambar/PDF/teks). Mime
    // lain merusak turn (dan riwayat) dengan "functionality not supported".
    const modelMime = modelFacingMime(info.mime, info.filename);
    if (modelMime) promptFiles.push({ uri: url, name: info.filename, mime: modelMime });
    else pathOnly.push({ filename: info.filename, absPath: path.resolve(info.absPath) });
  }
  // File biner dirujuk lewat path agar model bisa memakai tool (bash/read)
  // bila perlu; teks yang tampil di bubble tetap teks asli pengguna.
  const promptText =
    pathOnly.length === 0
      ? text
      : [
          text,
          "Attached files (saved on disk, not shown inline):",
          ...pathOnly.map((f) => `- ${f.filename}: ${f.absPath}`),
        ]
          .filter((line) => line !== "")
          .join("\n");
  return { userParts, promptFiles, promptText };
}
