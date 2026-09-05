/**
 * Pemilihan model LLM — logika murni (tanpa DOM / fetch), dipisah agar dapat
 * diuji `bun test` seperti `lib/routes.ts` dan `lib/session-summary.ts`.
 *
 * Dipakai bersama oleh `components/sessions/ModelPicker.tsx` (ganti model
 * Session yang sedang berjalan) dan `components/sessions/SessionList.tsx`
 * (pilih model saat membuat Session) supaya keduanya memakai aturan kunci,
 * pencarian, dan pengelompokan yang sama.
 */

import type { ModelOption } from "@/server/services/opencode-client";
import type { SessionModel } from "@/types";

/** Nilai khusus "pakai model default opencode" (mengirim `model: null`). */
export const DEFAULT_MODEL_KEY = "default";

/** Pemisah dalam kunci gabungan; modelID boleh memuat "/" sehingga bukan "/". */
const KEY_SEPARATOR = "\u0000";

/** Kunci gabungan provider+model untuk dipakai sebagai nilai/`key` React. */
export function modelKey(providerID: string, modelID: string): string {
  return `${providerID}${KEY_SEPARATOR}${modelID}`;
}

/** Kunci untuk sebuah `ModelOption`. */
export function optionKey(m: ModelOption): string {
  return modelKey(m.providerID, m.modelID);
}

/** Kunci untuk model Session saat ini; `null` -> `DEFAULT_MODEL_KEY`. */
export function keyOfSessionModel(model: SessionModel | null): string {
  return model ? modelKey(model.providerID, model.modelID) : DEFAULT_MODEL_KEY;
}

/**
 * Kunci -> `SessionModel`. `DEFAULT_MODEL_KEY` dan kunci tak lengkap
 * menghasilkan `null` (biarkan opencode memakai model default-nya).
 */
export function parseModelKey(key: string): SessionModel | null {
  if (key === DEFAULT_MODEL_KEY) return null;
  const [providerID, modelID] = key.split(KEY_SEPARATOR);
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

/** Satu provider beserta model-modelnya, untuk render berkelompok. */
export interface ModelGroup {
  providerID: string;
  providerName: string;
  models: ModelOption[];
}

/**
 * Kelompokkan model per provider, mempertahankan urutan kemunculan pertama
 * tiap provider (urutan dari server dianggap sudah bermakna).
 */
export function groupModels(models: readonly ModelOption[]): ModelGroup[] {
  const byProvider = new Map<string, ModelGroup>();
  for (const m of models) {
    let g = byProvider.get(m.providerID);
    if (!g) {
      g = { providerID: m.providerID, providerName: m.providerName, models: [] };
      byProvider.set(m.providerID, g);
    }
    g.models.push(m);
  }
  return [...byProvider.values()];
}

/**
 * Cari model berdasarkan kata kunci: cocok pada nama model, modelID, atau
 * nama provider (tanpa membedakan huruf besar/kecil). Seluruh kata dalam
 * query harus cocok, sehingga "opus 5" menemukan "Claude Opus 5" walau
 * urutan katanya berbeda dari teks aslinya.
 */
export function filterModels(models: readonly ModelOption[], query: string): ModelOption[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [...models];
  return models.filter((m) => {
    const haystack = `${m.name} ${m.modelID} ${m.providerName}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/**
 * Label ringkas model aktif untuk trigger picker. Model belum termuat dari
 * server (daftar kosong) tetap tampil sebagai `modelID` — informasi yang
 * sudah dimiliki Session, jadi trigger tidak pernah kosong.
 */
export function activeModelLabel(
  model: SessionModel | null,
  models: readonly ModelOption[],
): string {
  if (model === null) return "Default model";
  const found = models.find(
    (m) => m.providerID === model.providerID && m.modelID === model.modelID,
  );
  return found?.name ?? model.modelID;
}

/** Batas panjang nama model di header (karakter) sebelum dipotong. */
export const MODEL_NAME_MAX_LENGTH = 22;

/**
 * Nama model sependek mungkin untuk judul header.
 *
 * Provider sering memberi prefiks vendor pada `modelID`
 * (`kiro/claude-opus-5`, `anthropic/claude-sonnet-4`), dan prefiks itu tidak
 * menambah informasi saat nama sudah tampil di bawah judul Session. Segmen
 * terakhir setelah `/` diambil, lalu dipotong bila masih terlalu panjang untuk
 * lebar layar HP.
 */
export function shortModelName(label: string, maxLength: number = MODEL_NAME_MAX_LENGTH): string {
  // Segmen kosong dibuang lebih dulu, sehingga trailing slash diabaikan
  // (`a/b/` -> `b`) dan label yang hanya berisi slash menghasilkan "".
  const segments = label.split("/").filter((s) => s.trim().length > 0);
  const name = segments.at(-1)?.trim() ?? "";
  if (maxLength <= 0) return "";
  if (name.length <= maxLength) return name;
  // Sisakan satu karakter untuk elipsis agar total tepat `maxLength`.
  return `${name.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Ringkasan jumlah hasil pencarian untuk pembaca layar / footer dialog.
 */
export function describeModelCount(count: number): string {
  if (count === 0) return "No matching models";
  return count === 1 ? "1 model" : `${count} models`;
}
