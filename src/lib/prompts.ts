/**
 * Interactive_Prompt — logika murni (tanpa DOM).
 *
 * Dipisah dari `PromptCard.tsx` agar dapat diuji `bun test` (unit test 24.6):
 * - `getPromptActions`: aksi yang dirender untuk sebuah prompt.
 * - `groupPrompts`: beberapa permission identik (kind + title sama) menjadi
 *   SATU kartu (bug kartu nyepam).
 */
import type { InteractivePrompt, PromptQuestion, PromptResponse } from "@/types";

export type PromptActionVariant = "default" | "destructive" | "outline";

export interface PromptAction {
  key: string;
  label: string;
  response: PromptResponse;
  variant: PromptActionVariant;
  /** Ikon khusus (mis. "shield-check" untuk Always allow). */
  icon?: "shield-check";
}

/**
 * Aksi yang dirender untuk sebuah Interactive_Prompt (murni — diuji di 24.6).
 * Untuk `confirmation`: Approve, Always allow, Deny, dan Cancel; Cancel
 * memakai respon yang sama dengan Deny (Requirement 8.5).
 *
 * Menu MULTI-SELECT tidak memakai aksi per opsi — jawaban dikumpulkan lewat
 * checkbox lalu dikirim sekaligus `{ options: string[] }` (lihat PromptCard).
 */
export function getPromptActions(prompt: InteractivePrompt): PromptAction[] {
  if (prompt.type === "menu") {
    return (prompt.options ?? []).map((option) => ({
      key: `option-${option.label}`,
      label: option.label,
      response: { option: option.label },
      variant: "outline",
    }));
  }
  return [
    { key: "approve", label: "Approve", response: "approve", variant: "default" },
    {
      key: "always",
      label: "Always allow",
      response: "always",
      variant: "outline",
      icon: "shield-check",
    },
    { key: "deny", label: "Deny", response: "deny", variant: "destructive" },
    // Requirement 8.5: Cancel diperlakukan sebagai respon Deny yang sama.
    { key: "cancel", label: "Cancel", response: "deny", variant: "outline" },
  ];
}

/**
 * Daftar pertanyaan yang dirender kartu — multi-question memakai field
 * `questions`; pertanyaan tunggal diwrap dari field legacy.
 * Murni (diuji tanpa DOM) agar konsisten dengan helper lain di file ini.
 */
export function getPromptQuestions(prompt: InteractivePrompt): PromptQuestion[] {
  if (prompt.questions && prompt.questions.length > 0) return prompt.questions;
  if (prompt.kind !== "question") return [];
  return [
    {
      question: prompt.title,
      options: prompt.options ?? null,
      multiple: prompt.multiple === true ? true : undefined,
      custom: prompt.custom === true ? true : undefined,
    },
  ];
}

/**
 * Kelompokkan prompt pending yang identik (kind + title sama) menjadi satu
 * kartu. Kunci sama dengan sisi server (`permissionGroupKey`) agar kartu yang
 * dijawab user persis grup yang di-fan-out server. Urutan kemunculan
 * anggota pertama dipertahankan.
 */
export function groupPrompts(prompts: readonly InteractivePrompt[]): InteractivePrompt[][] {
  const groups = new Map<string, InteractivePrompt[]>();
  for (const p of prompts) {
    const key = `${p.kind}\u0000${p.title ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()];
}
