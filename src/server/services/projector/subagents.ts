/**
 * Pelacakan sub-agent: tautan Session anak opencode ke tool call `task` yang
 * membuatnya, `parentToolID` konten sub-agent, dan part `subagent`
 * (status/statistik terakumulasi per tool call).
 */
import type { AgentTokenUsage } from "../../agents/types";
import type { MessageStore } from "./message-store";

export class SubagentTracker {
  /** Session anak opencode -> tool call `task` yang membuatnya. */
  private readonly childTools = new Map<string, string>();
  /** Tool call `task` per Session agent yang belum punya Session anak (FIFO). */
  private readonly pendingTasks = new Map<string, string[]>();
  /** Info sub-agent terakumulasi per tool call (status, token, …). */
  private readonly subagents = new Map<string, Record<string, unknown>>();

  constructor(private readonly messages: MessageStore) {}

  /** `parentToolID` konten: dari event, atau tautan Session anak (opencode). */
  parentField(agentSessionID: string, explicit?: string): { parentToolID?: string } {
    const parent = explicit ?? this.childTools.get(agentSessionID);
    return parent ? { parentToolID: parent } : {};
  }

  /** Tool `task` opencode akan membuat Session anak — antrekan sampai dibuat. */
  queueTask(agentSessionID: string, toolID: string): void {
    const queue = this.pendingTasks.get(agentSessionID) ?? [];
    if (!queue.includes(toolID)) queue.push(toolID);
    this.pendingTasks.set(agentSessionID, queue);
  }

  /**
   * Sub-agent opencode: Session anak milik tool call `task` induk yang
   * belum punya anak (urutan pemanggilan = urutan pembuatan).
   */
  linkChild(childID: string, parentID: string): void {
    if (this.childTools.has(childID)) return;
    const toolID = this.pendingTasks.get(parentID)?.shift();
    if (toolID) this.childTools.set(childID, toolID);
  }

  /**
   * Gabungkan info sub-agent lalu tulis part `subagent` (info lengkap) ke
   * pesan turn berjalan — satu part per tool call per pesan.
   */
  put(
    agentSessionID: string,
    messageID: string | undefined,
    toolID: string,
    patch: Record<string, unknown>,
  ): void {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const info = { ...(this.subagents.get(toolID) ?? {}), ...defined };
    this.subagents.set(toolID, info);
    const msgId = messageID ?? this.messages.lastMessages.get(agentSessionID);
    if (!msgId) return;
    const state = this.messages.message(agentSessionID, msgId);
    if (!state) return;
    this.messages.put(state, msgId, {
      ...info,
      id: `prt_${msgId}_subagent_${toolID}`,
      type: "subagent",
      toolID,
    });
  }

  /** Step Session anak opencode = kerja sub-agent: token ke kartunya. */
  addStepTokens(
    agentSessionID: string,
    messageID: string | undefined,
    tokens: AgentTokenUsage,
  ): void {
    const toolID = this.childTools.get(agentSessionID);
    if (!toolID) return;
    const prev = this.subagents.get(toolID)?.tokens;
    const used =
      tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
    this.put(agentSessionID, messageID, toolID, {
      tokens: (typeof prev === "number" ? prev : 0) + used,
    });
  }
}
