/**
 * Satu pertanyaan dalam request tool `question` opencode. Satu request bisa
 * membaca BEBERAPA pertanyaan (multi-question); pertanyaan pertama tetap
 * disalin ke field legacy `title`/`options`/`multiple`/`custom` di
 * `InteractivePrompt` agar kode lama tetap bekerja.
 */
export interface PromptQuestion {
  /** Teks pertanyaan yang tampil ke user. */
  question: string | null;
  /** Label pendek (header) dari skema opencode — opsional. */
  header?: string | null;
  options: PromptOption[] | null;
  /** Boleh pilih lebih dari satu opsi (default false). */
  multiple?: boolean;
  /** Boleh jawab bebas selain opsi terdaftar (default true). */
  custom?: boolean;
}

/**
 * Tipe Interactive_Prompt (permission/question).
 *
 * `InteractivePrompt` bersumber dari event terstruktur opencode
 * (`permission.asked` / `question.asked`) lewat field `kind` — bukan hasil
 * regex atas teks TUI (`prompt-detector.ts` dihapus).
 */
export type PromptType = "confirmation" | "menu";

/**
 * Satu opsi question opencode: label yang dikirim balik sebagai jawaban
 * plus keterangan tampilan (skema tool `question`: `{label, description?}`).
 * String polos (data lama / varian event tanpa `description`) dinormalisasi
 * jadi `{ label }` — lihat `normalizePromptOptions` di bawah.
 */
export interface PromptOption {
  label: string;
  description: string | null;
}

/**
 * Normalisasi opsi question ke `PromptOption[]`:
 * - `{ label, description? }` (skema question opencode) -> dipakai apa adanya.
 * - string polos (DB lama) -> `{ label, description: null }`.
 * Entri tanpa label valid di-skip.
 */
export function normalizePromptOptions(raw: unknown): PromptOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PromptOption[] = [];
  for (const o of raw) {
    if (typeof o === "string") {
      if (o.trim() !== "") out.push({ label: o, description: null });
    } else if (typeof o === "object" && o !== null) {
      const label = (o as { label?: unknown }).label;
      if (typeof label === "string" && label.trim() !== "") {
        const description = (o as { description?: unknown }).description;
        out.push({
          label,
          description:
            typeof description === "string" && description.trim() !== "" ? description : null,
        });
      }
    }
  }
  return out;
}

export type PromptStatus = "pending" | "resolved";

/** Sumber Interactive_Prompt: izin tool (permission) atau pertanyaan (question). */
export type PromptKind = "permission" | "question";

export interface InteractivePrompt {
  /** Id request opencode (`per_...` / `que_...`) — dipakai untuk reply. */
  id: string;
  sessionId: string;
  kind: PromptKind;
  type: PromptType;
  /** Teks pertanyaan (question) atau deskripsi izin (permission). */
  title: string | null;
  /** Opsi question (menu). null = bukan menu / tanpa opsi. */
  options: PromptOption[] | null;
  /**
   * Question saja: boleh pilih LEBIH dari satu opsi (skema tool `question`
   * opencode, default false — single choice). Jawaban tetap dikirim sebagai
   * array label via reply API.
   */
  multiple?: boolean;
  /**
   * Question saja: SELURUH pertanyaan dalam request (multi-question).
   * undefined/[] = data lama — pertanyaan tunggal ada di field legacy di
   * atas (title/options/multiple/custom).
   */
  questions?: PromptQuestion[];
  /**
   * Question saja: user boleh mengetik jawaban bebas selain opsi yang
   * terdaftar (flag `custom` di skema question opencode, default true).
   */
  custom?: boolean;
  status: PromptStatus;
  createdAt: number;
  resolvedAt: number | null;
}

/**
 * Respon user atas Interactive_Prompt.
 * - question single choice: `{ option }`.
 * - question multi-select: `{ options: string[] }` (label terpilih, urut
 *   sesuai tampilan; minimal satu).
 * - question multi-question: `{ answers: string[][] }` — SATU array label per
 *   pertanyaan, urut sesuai `questions` (jawaban bebas masuk sebagai label).
 */
export type PromptResponse =
  | "approve"
  | "always"
  | "deny"
  | "cancel"
  | { option: string }
  | { options: string[] }
  | { answers: string[][] };
