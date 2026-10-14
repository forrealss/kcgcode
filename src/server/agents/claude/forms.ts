/**
 * Form v2 untuk tool interaktif Claude Code: `AskUserQuestion` (pertanyaan)
 * dan `ExitPlanMode` (persetujuan rencana), beserta penerjemahan jawabannya
 * kembali ke hasil `canUseTool`.
 */
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AgentForm, AgentFormAnswer } from "../types";

/** Keputusan kartu persetujuan rencana (`ExitPlanMode`) -> mode berikutnya. */
const PLAN_DECISIONS = [
  { value: "acceptEdits", label: "Yes, and auto-accept edits" },
  { value: "default", label: "Yes, and approve each edit" },
  { value: "plan", label: "No, keep planning" },
] as const;

/** Field keputusan pada form persetujuan rencana. */
export const PLAN_DECISION_KEY = "decision";

/** Form v2 dari input `AskUserQuestion` (`questions[]`). */
export function formFromQuestions(
  id: string,
  sessionID: string,
  input: Record<string, unknown>,
): AgentForm {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  return {
    id,
    sessionID,
    title: "Questions",
    metadata: { kind: "question" },
    fields: questions.map((q, i) => {
      const item = (q ?? {}) as Record<string, unknown>;
      const options = Array.isArray(item.options)
        ? item.options
            .map((o) => (o ?? {}) as Record<string, unknown>)
            .filter((o) => typeof o.label === "string")
            .map((o) => ({
              value: o.label as string,
              label: o.label as string,
              ...(typeof o.description === "string" ? { description: o.description } : {}),
            }))
        : [];
      return {
        key: `q${i}`,
        type: item.multiSelect === true ? "multiselect" : "string",
        ...(typeof item.header === "string" ? { title: item.header } : {}),
        ...(typeof item.question === "string" ? { description: item.question } : {}),
        options,
        custom: true,
      };
    }),
  };
}

/**
 * Jawaban form -> format jawaban `AskUserQuestion`: teks pertanyaan -> label
 * (multi-select digabung koma).
 */
export function questionAnswers(
  input: Record<string, unknown>,
  answer: AgentFormAnswer,
): Record<string, string> {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const map: Record<string, string> = {};
  questions.forEach((q, i) => {
    const question = (q as { question?: unknown } | null)?.question;
    if (typeof question !== "string") return;
    const value = answer[`q${i}`];
    map[question] = Array.isArray(value)
      ? value.join(", ")
      : value === undefined
        ? ""
        : String(value);
  });
  return map;
}

/**
 * Form persetujuan rencana dari input `ExitPlanMode` (Claude selesai
 * merencanakan di plan mode). Isi rencana (markdown) dibawa di
 * `metadata.plan`; jawaban bebas = masukan agar Claude merevisi rencana.
 */
export function planForm(id: string, sessionID: string, input: Record<string, unknown>): AgentForm {
  const plan = typeof input.plan === "string" ? input.plan : null;
  return {
    id,
    sessionID,
    title: "Ready to implement this plan?",
    metadata: { kind: "plan", ...(plan ? { plan } : {}) },
    fields: [
      {
        key: PLAN_DECISION_KEY,
        type: "string",
        title: "Plan",
        description: "Ready to implement this plan?",
        options: PLAN_DECISIONS.map((d) => ({ value: d.value, label: d.label })),
        custom: true,
      },
    ],
  };
}

/**
 * Hasil `canUseTool` untuk keputusan rencana: setuju -> jalankan rencana dan
 * ganti mode Session (seperti Claude Code CLI); tetap merencanakan / masukan
 * bebas -> tolak agar Claude merevisi rencana.
 */
export function planDecision(input: Record<string, unknown>, value: unknown): PermissionResult {
  const decision = typeof value === "string" ? value.trim() : "";
  if (decision === "acceptEdits" || decision === "default") {
    return {
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: [{ type: "setMode", mode: decision, destination: "session" }],
    };
  }
  if (decision === "" || decision === "plan") {
    return { behavior: "deny", message: "The user wants to keep planning. Refine the plan." };
  }
  return {
    behavior: "deny",
    message: `The user wants changes to the plan before implementing it: ${decision}`,
  };
}
