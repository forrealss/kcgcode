/**
 * Interactive_Prompt — logika murni (tanpa DOM).
 *
 * Dipisah dari `PromptCard.tsx` agar dapat diuji `bun test` (unit test 24.6):
 * - `getPromptActions`: aksi yang dirender untuk sebuah prompt.
 * - `groupPrompts`: beberapa permission identik (kind + title sama) menjadi
 *   SATU kartu (bug kartu nyepam).
 */
import type { InteractivePrompt, PromptResponse } from "@/types";

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
 */
export function getPromptActions(prompt: InteractivePrompt): PromptAction[] {
  if (prompt.type === "menu") {
    return (prompt.options ?? []).map((option) => ({
      key: `option-${option}`,
      label: option,
      response: { option },
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
