/**
 * Pemakaian turn: `session.step.ended` (cost/tokens) Session akar & anak
 * dijumlahkan per Session lokal -> part `usage` di pesan terakhir saat turn
 * berakhir.
 */
import type { AgentTokenUsage } from "../../agents/types";
import type { MessageStore } from "./message-store";

interface TurnUsage {
  cost: number | null;
  input: number;
  output: number;
  reasoning: number;
  read: number;
  write: number;
}

export class TurnUsageTracker {
  /** Pemakaian turn berjalan per Session lokal (akar + anak). */
  private readonly turnUsage = new Map<string, TurnUsage>();

  constructor(private readonly messages: MessageStore) {}

  /** Mulai hitungan baru (pemakaian dihitung per eksekusi Session akar). */
  clear(sessionId: string): void {
    this.turnUsage.delete(sessionId);
  }

  /** Tambahkan pemakaian satu step ke turn berjalan Session lokal. */
  add(sessionId: string, cost: number | undefined, tokens: AgentTokenUsage): void {
    const cur = this.turnUsage.get(sessionId) ?? {
      cost: null,
      input: 0,
      output: 0,
      reasoning: 0,
      read: 0,
      write: 0,
    };
    if (typeof cost === "number") cur.cost = (cur.cost ?? 0) + cost;
    cur.input += tokens.input;
    cur.output += tokens.output;
    cur.reasoning += tokens.reasoning;
    cur.read += tokens.cache.read;
    cur.write += tokens.cache.write;
    this.turnUsage.set(sessionId, cur);
  }

  /** Tulis part `usage` turn (bila ada pemakaian) ke pesan terakhir turn. */
  flush(sessionId: string, agentSessionID: string): void {
    const usage = this.turnUsage.get(sessionId);
    this.turnUsage.delete(sessionId);
    const msgId = this.messages.lastMessages.get(agentSessionID);
    if (!usage || !msgId) return;
    const state = this.messages.message(agentSessionID, msgId);
    if (!state) return;
    this.messages.put(state, msgId, {
      id: `prt_${msgId}_usage`,
      type: "usage",
      ...(usage.cost !== null ? { cost: usage.cost } : {}),
      tokens: {
        input: usage.input,
        output: usage.output,
        reasoning: usage.reasoning,
        cache: { read: usage.read, write: usage.write },
      },
    });
  }
}
