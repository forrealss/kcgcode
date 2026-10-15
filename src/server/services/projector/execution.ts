/**
 * Siklus eksekusi Session akar: turn yang dimulai agent sendiri (tanpa
 * prompt dari bridge) dibuka saat `session.execution.started`; akhir turn
 * (sukses / gagal / dibatalkan) menulis part `usage`, membuang state rakitan,
 * dan menutup turn. Akhir turn hanya dari Session AKAR: sub-agent (child
 * session) selesai lebih dulu dari induknya.
 */
import type { AgentEvent, AgentEventData } from "../../agents/types";
import { describeAgentError } from "../session-events";
import type { ProjectorContext } from "./types";

export type ExecutionEndEvent = Extract<
  AgentEvent,
  {
    type:
      | "session.execution.succeeded"
      | "session.execution.failed"
      | "session.execution.interrupted";
  }
>;

export function executionStarted(
  ctx: ProjectorContext,
  data: AgentEventData<"session.execution.started">,
): void {
  const { opts } = ctx;
  const turns = opts.turns;
  const sessionId = opts.resolve(data.sessionID);
  if (!sessionId) return;
  // Eksekusi tanpa prompt dari bridge (mis. agent dibangunkan hasil
  // sub-agent latar belakang): buka turn agar kontennya tersimpan.
  if (opts.isRoot(sessionId, data.sessionID)) {
    // Pemakaian dihitung per eksekusi Session akar.
    ctx.usage.clear(sessionId);
    if (!turns.has(sessionId)) opts.beginTurn?.(sessionId);
  }
  turns.keepAlive(sessionId);
}

export function executionEnded(ctx: ProjectorContext, ev: ExecutionEndEvent): void {
  const { opts } = ctx;
  const turns = opts.turns;
  const agentSessionID = ev.data.sessionID;
  const sessionId = opts.resolve(agentSessionID);
  if (!sessionId || !opts.isRoot(sessionId, agentSessionID)) return;
  ctx.usage.flush(sessionId, agentSessionID);
  ctx.messages.reset(agentSessionID);
  // Compact tidak mungkin berlanjut setelah eksekusi berakhir.
  opts.setCompacting?.(sessionId, false);
  if (ev.type === "session.execution.succeeded") {
    turns.finish(sessionId, "idle");
  } else if (ev.type === "session.execution.failed") {
    const message = describeAgentError(ev.data.error);
    if (turns.has(sessionId)) {
      // Tutup dengan error tertunda: pesan error hanya ditulis ke
      // history bila tidak ada konten setelahnya.
      turns.noteError(sessionId, message);
      turns.finish(sessionId, "idle");
    } else {
      opts.onError?.(sessionId, message);
    }
  } else {
    // Dibatalkan (interrupt user / shutdown): simpan parts tanpa banner.
    turns.finish(sessionId);
  }
}
