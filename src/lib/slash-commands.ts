/**
 * Slash command di composer — logika murni (tanpa DOM / fetch), diuji
 * `bun test` seperti `lib/composer.ts`.
 *
 * Aturan mengikuti Claude Code CLI: command hanya berlaku sebagai token
 * PERTAMA pesan (`/nama argumen…`). Mengetik `/` di awal input membuka
 * daftar; memilih satu command mengganti token itu dengan `/nama `.
 */
import type { SlashCommandInfo } from "@/types";

/** Token `/query` aktif di awal input. */
export interface ActiveSlash {
  /** Teks setelah `/` sampai kursor (penyaring daftar). */
  query: string;
  /** Akhir token pertama (indeks spasi pertama, atau panjang teks). */
  end: number;
}

/** Akhir token pertama: indeks whitespace pertama, atau panjang teks. */
function tokenEnd(text: string): number {
  const ws = text.search(/\s/);
  return ws < 0 ? text.length : ws;
}

/**
 * Token `/query` yang sedang diketik — hanya bila input diawali `/` dan
 * kursor masih di token pertama (belum ada spasi sebelum kursor). `//…`
 * bukan command (mis. komentar kode yang ditempel).
 */
export function activeSlashCommand(text: string, caret: number): ActiveSlash | null {
  if (!text.startsWith("/") || text.startsWith("//")) return null;
  if (caret < 1 || caret > text.length) return null;
  const end = tokenEnd(text);
  if (caret > end) return null;
  return { query: text.slice(1, caret), end };
}

/** Ganti token pertama dengan `/nama` + satu spasi (siap diberi argumen). */
export function applySlashCommand(text: string, name: string): string {
  const rest = text.slice(tokenEnd(text));
  return `/${name}${/^\s/.test(rest) ? rest : ` ${rest}`}`;
}

/** Peringkat kecocokan (kecil = lebih relevan); null = tidak cocok. */
function rank(c: SlashCommandInfo, q: string): number | null {
  if (q === "") return 0;
  const name = c.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (c.aliases?.some((a) => a.toLowerCase().startsWith(q))) return 2;
  // Command bernamespace (`plugin:nama`): cocokkan juga bagian setelah `:`.
  const local = name.slice(name.lastIndexOf(":") + 1);
  if (local.startsWith(q)) return 3;
  if (name.includes(q)) return 4;
  if (q.length >= 2 && c.description?.toLowerCase().includes(q)) return 5;
  return null;
}

/**
 * Saring & urutkan command untuk query: nama persis, awalan nama, awalan
 * alias, awalan nama tanpa namespace, potongan nama, lalu deskripsi. Dalam
 * satu peringkat urut abjad. Query kosong = seluruh command urut abjad.
 */
export function filterCommands(
  commands: readonly SlashCommandInfo[],
  query: string,
): SlashCommandInfo[] {
  const q = query.toLowerCase();
  const scored: { c: SlashCommandInfo; r: number }[] = [];
  for (const c of commands) {
    const r = rank(c, q);
    if (r !== null) scored.push({ c, r });
  }
  scored.sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name));
  return scored.map((s) => s.c);
}

/** Nama + alias seluruh command (untuk menyorot command yang dikenali). */
export function commandNames(commands: readonly SlashCommandInfo[]): Set<string> {
  const out = new Set<string>();
  for (const c of commands) {
    out.add(c.name);
    for (const a of c.aliases ?? []) out.add(a);
  }
  return out;
}

/**
 * Token `/nama` di awal teks bila `nama` dikenal — untuk lapisan sorot
 * composer; null bila input bukan command yang dikenali.
 */
export function leadingCommand(text: string, known: ReadonlySet<string>): string | null {
  if (!text.startsWith("/")) return null;
  const token = text.slice(0, tokenEnd(text));
  return known.has(token.slice(1)) ? token : null;
}
