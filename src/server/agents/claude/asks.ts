/**
 * Permintaan interaktif dari `canUseTool`: izin tool (`permission.asked`),
 * `AskUserQuestion` dan `ExitPlanMode` (`form.created`). Promise hasilnya
 * ditahan sampai user menjawab (`permission.reply` / `form.reply|cancel`),
 * request di-abort, atau Session ditutup.
 */
import { randomUUID } from "node:crypto";
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type { SimpleResult } from "../../result";
import { AGENT_REQUEST_GONE, type AgentEvent, type AgentFormAnswer } from "../types";
import {
  formFromQuestions,
  PLAN_DECISION_KEY,
  planDecision,
  planForm,
  questionAnswers,
} from "./forms";
import { permissionName, permissionTarget } from "./translate";

interface PendingAsk {
  sessionId: string;
  kind: "permission" | "question" | "plan";
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  allowAlways: boolean;
  resolve: (result: PermissionResult) => void;
}

export interface PendingAsks {
  /** Handler `canUseTool` SDK untuk Session `sessionId`. */
  canUseTool(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult>;
  /** Tolak seluruh ask yang menunggu untuk Session (abort/close). */
  dropSession(sessionId: string, message: string): void;
  replyPermission(requestID: string, decision: "once" | "always" | "reject"): Promise<SimpleResult>;
  replyForm(formID: string, answer: AgentFormAnswer): Promise<SimpleResult>;
  cancelForm(formID: string): Promise<SimpleResult>;
}

function askKind(toolName: string): PendingAsk["kind"] {
  if (toolName === "AskUserQuestion") return "question";
  if (toolName === "ExitPlanMode") return "plan";
  return "permission";
}

export function createPendingAsks(emit: (ev: AgentEvent) => void): PendingAsks {
  const pending = new Map<string, PendingAsk>();

  function take(requestId: string, kind: PendingAsk["kind"]): PendingAsk | null {
    const ask = pending.get(requestId);
    if (!ask || ask.kind !== kind) return null;
    pending.delete(requestId);
    return ask;
  }

  function announce(
    requestID: string,
    sessionId: string,
    kind: PendingAsk["kind"],
    toolName: string,
    input: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): void {
    if (kind === "question") {
      emit({
        type: "form.created",
        data: { form: formFromQuestions(requestID, sessionId, input) },
      });
      return;
    }
    if (kind === "plan") {
      emit({ type: "form.created", data: { form: planForm(requestID, sessionId, input) } });
      return;
    }
    // Akses di luar direktori project dilaporkan CLI lewat `blockedPath`.
    const blocked = typeof options.blockedPath === "string" ? options.blockedPath : null;
    const target = blocked ?? permissionTarget(input);
    emit({
      type: "permission.asked",
      data: {
        id: requestID,
        sessionID: sessionId,
        action: blocked ? "external_directory" : permissionName(toolName),
        resources: target ? [target] : [],
      },
    });
  }

  return {
    canUseTool(sessionId, toolName, input, options) {
      const kind = askKind(toolName);
      const requestID = `${kind === "permission" ? "per" : "frm"}_${randomUUID()}`;
      const result = new Promise<PermissionResult>((resolve) => {
        pending.set(requestID, {
          sessionId,
          kind,
          input,
          suggestions: options.suggestions,
          allowAlways: options.suppressAlwaysAllowRule !== true,
          resolve,
        });
        options.signal.addEventListener(
          "abort",
          () => {
            if (!pending.delete(requestID)) return;
            resolve({ behavior: "deny", message: "Aborted.", interrupt: true });
          },
          { once: true },
        );
      });
      announce(requestID, sessionId, kind, toolName, input, options);
      return result;
    },

    dropSession(sessionId, message) {
      for (const [id, ask] of pending) {
        if (ask.sessionId !== sessionId) continue;
        pending.delete(id);
        ask.resolve({ behavior: "deny", message, interrupt: true });
      }
    },

    async replyPermission(requestID, decision) {
      const ask = take(requestID, "permission");
      if (!ask) return { ok: false, error: AGENT_REQUEST_GONE };
      if (decision === "reject") {
        ask.resolve({ behavior: "deny", message: "The user denied this tool call." });
        return { ok: true };
      }
      // "Always allow" berlaku selama Session — tidak menulis aturan ke file
      // settings user dari satu ketukan di HP.
      const updatedPermissions =
        decision === "always" && ask.allowAlways
          ? ask.suggestions?.map((s) => ({ ...s, destination: "session" as const }))
          : undefined;
      ask.resolve({
        behavior: "allow",
        updatedInput: ask.input,
        ...(updatedPermissions?.length ? { updatedPermissions } : {}),
      });
      return { ok: true };
    },

    async replyForm(formID, answer) {
      const plan = take(formID, "plan");
      if (plan) {
        plan.resolve(planDecision(plan.input, answer[PLAN_DECISION_KEY]));
        return { ok: true };
      }
      const ask = take(formID, "question");
      if (!ask) return { ok: false, error: AGENT_REQUEST_GONE };
      ask.resolve({
        behavior: "allow",
        updatedInput: { ...ask.input, answers: questionAnswers(ask.input, answer) },
      });
      return { ok: true };
    },

    async cancelForm(formID) {
      const ask = take(formID, "question") ?? take(formID, "plan");
      if (!ask) return { ok: false, error: AGENT_REQUEST_GONE };
      ask.resolve({
        behavior: "deny",
        message:
          ask.kind === "plan"
            ? "The user dismissed the plan. Keep planning."
            : "The user dismissed the question.",
      });
      return { ok: true };
    },
  };
}
