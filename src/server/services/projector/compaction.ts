/**
 * Compact (`agent.compaction`) -> status "compacting" Session lokal; saat
 * selesai, part `compaction` (penanda "conversation compacted" beserta
 * ukuran konteks sebelum/sesudah) di pesan turn yang sedang berjalan.
 */
import type { AgentEventData } from "../../agents/types";
import type { ProjectorContext } from "./types";

/**
 * Compact Session akar: status compacting, penanda di timeline saat selesai,
 * atau banner bila gagal (kecuali dibatalkan user).
 */
export function compaction(ctx: ProjectorContext, data: AgentEventData<"agent.compaction">): void {
  const { opts, messages } = ctx;
  const agentSessionID = data.sessionID;
  const sessionId = opts.resolve(agentSessionID);
  if (!sessionId || !opts.isRoot(sessionId, agentSessionID)) return;
  const turns = opts.turns;
  turns.keepAlive(sessionId);
  opts.setCompacting?.(sessionId, data.phase === "started");
  if (data.phase === "failed") {
    if (data.error?.type !== "aborted") {
      opts.onError?.(
        sessionId,
        `Couldn't compact the conversation: ${data.error?.message ?? "unknown error"}`,
      );
    }
    return;
  }
  if (data.phase !== "ended") return;
  // Penanda ditempel ke pesan turn berjalan; tanpa pesan (compact sebagai
  // satu-satunya isi turn di opencode) dibuat pesan assistant tersendiri.
  let messageID = data.assistantMessageID ?? messages.lastMessages.get(agentSessionID);
  if (!messageID) {
    messageID = `msg_compaction_${agentSessionID}_${opts.now()}`;
    messages.lastMessages.set(agentSessionID, messageID);
    turns.noteAssistantMessage(sessionId, messageID);
  }
  const state = messages.message(agentSessionID, messageID);
  if (!state) return;
  const n = [...state.parts.values()].filter((p) => p.type === "compaction").length;
  messages.put(state, messageID, {
    id: `prt_${messageID}_compaction_${n}`,
    type: "compaction",
    trigger: data.trigger,
    ...(data.preTokens !== undefined ? { preTokens: data.preTokens } : {}),
    ...(data.postTokens !== undefined ? { postTokens: data.postTokens } : {}),
    time: { created: opts.now() },
  });
}
