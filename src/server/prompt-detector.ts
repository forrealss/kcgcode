/**
 * Prompt_Detector — deteksi pola Interactive_Prompt dari Output_Stream.
 * Sesuai `design.md` — `prompt-detector.ts`.
 *
 * Fungsi murni `detectPrompt(bufferedText)` dijalankan oleh Session_Manager
 * setiap kali buffer Output_Stream terbaru (beberapa baris terakhir) berubah.
 *
 * Pola yang dikenali (Requirement 6.1, 6.2):
 * - Konfirmasi y/n: `(y/n)`, `[y/N]`, "do you want to proceed"
 * - Izin eksekusi command / edit file: "Allow this command?", "Apply this edit?"
 * - Menu pilihan: baris bernomor berurutan (`1) ...`, `2) ...`) -> `menu`
 */

export type InteractivePromptDraft =
  | { type: "confirmation"; options: null }
  | { type: "menu"; options: string[] };

const CONFIRMATION_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/N\]/,
  /do you want to proceed/i,
  /allow this command\?/i,
  /apply this edit\?/i,
  /proceed with this (action|command|edit)\?/i,
];

/** Ambil baris bernomor berurutan mulai dari 1, mis. `1) opsi`, `2. opsi`. */
function parseNumberedMenu(text: string): string[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const options: string[] = [];
  let expected = 1;
  for (const line of lines) {
    const m = line.match(/^(\d+)[).]\s+(.+)$/);
    if (m) {
      const index = Number(m[1]);
      const option = m[2];
      if (index === expected && option !== undefined) {
        options.push(option.trim());
        expected += 1;
      }
    }
  }
  if (options.length >= 2) return options;
  return null;
}

/**
 * Mendeteksi Interactive_Prompt pada teks buffer Output_Stream.
 * Mengembalikan draft `confirmation` (tanpa opsi) atau `menu` (dengan opsi),
 * atau `null` bila tidak ada pola yang dikenali.
 */
export function detectPrompt(bufferedText: string): InteractivePromptDraft | null {
  if (CONFIRMATION_PATTERNS.some((re) => re.test(bufferedText))) {
    return { type: "confirmation", options: null };
  }
  const options = parseNumberedMenu(bufferedText);
  if (options) return { type: "menu", options };
  return null;
}
