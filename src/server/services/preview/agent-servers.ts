/**
 * Deteksi dev server yang dijalankan agent sendiri (mis. `npm run dev` di
 * shell background): URL lokal di output tool call. Port yang ditemukan
 * dicoba diadopsi supervisor (`DevServerManager.adopt`) agar tetap bisa
 * di-preview — tanpa agent perlu tahu soal kcgcode.
 *
 * Hanya output tool (bukan teks jawaban): teks jawaban sering berisi contoh
 * URL atau URL lama.
 */
import type { MessagePart } from "../../../types";
import { detectPortFromLine } from "./dev-servers";

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map(outputText).join("\n");
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.output === "string") return o.output;
    if (typeof o.stdout === "string") return o.stdout;
  }
  return "";
}

/** Port lokal yang muncul di output satu part tool (urut kemunculan, unik). */
export function portsFromToolPart(part: MessagePart): number[] {
  if (part.type !== "tool") return [];
  const text = outputText(part.state?.output);
  if (!text) return [];
  const ports: number[] = [];
  for (const line of text.split("\n").slice(-200)) {
    const port = detectPortFromLine(line);
    if (port !== null && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

/** Port dari seluruh part tool sebuah pesan. */
export function portsFromParts(parts: MessagePart[]): number[] {
  const out: number[] = [];
  for (const p of parts)
    for (const port of portsFromToolPart(p)) if (!out.includes(port)) out.push(port);
  return out;
}
