/**
 * Pembukuan pesan assistant yang sedang dirakit: part per pesan, pemilik &
 * nama tool call, serta pesan terakhir per Session agent. Semua part keluar
 * lewat `put` agar tersimpan lokal sekaligus diteruskan ke `TurnStream`.
 */
import type { MessagePart } from "../../../types";
import type { AgentProjectorOptions, MessageState } from "./types";

export class MessageStore {
  /** `${agentSessionID}:${messageID}` -> part yang sedang dirakit. */
  private readonly messages = new Map<string, MessageState>();
  /** id tool call -> nama tool (dari `session.tool.input.started`). */
  readonly toolNames = new Map<string, string>();
  /** id tool call -> kunci pesan pemiliknya. */
  private readonly toolOwner = new Map<string, string>();
  /** Pesan assistant terakhir per Session agent (tempat penanda compact). */
  readonly lastMessages = new Map<string, string>();

  constructor(private readonly opts: AgentProjectorOptions) {}

  /** State pesan (dibuat bila belum ada); undefined bila Session tak dikenal. */
  message(agentSessionID: string, messageID: string): MessageState | undefined {
    const sessionId = this.opts.resolve(agentSessionID);
    if (!sessionId) return undefined;
    const key = `${agentSessionID}:${messageID}`;
    let state = this.messages.get(key);
    if (!state) {
      state = { sessionId, parts: new Map(), emitted: new Set() };
      this.messages.set(key, state);
    }
    return state;
  }

  /** Catat pesan pemilik tool call (untuk dibersihkan bersama pesannya). */
  ownTool(toolId: string, agentSessionID: string, messageID: string): void {
    this.toolOwner.set(toolId, `${agentSessionID}:${messageID}`);
  }

  put(state: MessageState, messageID: string, part: MessagePart): void {
    const id = part.id as string;
    state.parts.set(id, part);
    this.opts.turns.acceptPart(state.sessionId, messageID, { ...part, messageID });
  }

  /** Buang state rakitan milik Session agent (turn ditutup). */
  reset(agentSessionID: string): void {
    this.lastMessages.delete(agentSessionID);
    const prefix = `${agentSessionID}:`;
    for (const key of [...this.messages.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.messages.delete(key);
      for (const [toolId, owner] of this.toolOwner) {
        if (owner === key) {
          this.toolOwner.delete(toolId);
          this.toolNames.delete(toolId);
        }
      }
    }
  }
}
