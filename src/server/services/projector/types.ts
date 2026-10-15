/**
 * Tipe bersama Agent_Projector: opsi projector, state rakitan per pesan
 * assistant, dan konteks yang dibagi antar handler event.
 */
import type { InteractivePrompt, MessagePart } from "../../../types";
import type { TurnStream } from "../turn-stream";
import type { MessageStore } from "./message-store";
import type { SubagentTracker } from "./subagents";
import type { TurnUsageTracker } from "./usage";

export interface AgentProjectorOptions {
  turns: TurnStream;
  now: () => number;
  /** Session lokal pemilik Session agent (induk maupun child sub-agent). */
  resolve(agentSessionID: string): string | undefined;
  /** Apakah `agentSessionID` adalah Session akar milik Session lokal. */
  isRoot(sessionId: string, agentSessionID: string): boolean;
  /** Petakan child sub-agent ke Session lokal induknya. */
  mapChild(childID: string, sessionId: string): void;
  /** Judul Session baru dari agent — kembalikan false bila tidak berubah. */
  setTitle(sessionId: string, title: string): void;
  /** Permission mode yang berlaku di agent berubah (Session akar). */
  setPermissionMode?(sessionId: string, mode: string): void;
  /** Agent mulai / selesai meringkas riwayat Session (compact). */
  setCompacting?(sessionId: string, compacting: boolean): void;
  /** Buka turn untuk eksekusi yang dimulai agent sendiri (tanpa prompt bridge). */
  beginTurn?(sessionId: string): void;
  /** Simpan prompt baru; kembalikan false bila duplikat. */
  insertPrompt(prompt: InteractivePrompt): boolean;
  onPrompt?: (prompt: InteractivePrompt) => void;
  onError?: (sessionId: string, message: string) => void;
}

/** Part yang sedang dirakit untuk satu pesan assistant agent. */
export interface MessageState {
  sessionId: string;
  parts: Map<string, MessagePart>;
  /** Part text/reasoning yang sudah dikirim (token pertama sudah tiba). */
  emitted: Set<string>;
}

/** State & dependensi yang dibagi handler event projector. */
export interface ProjectorContext {
  opts: AgentProjectorOptions;
  messages: MessageStore;
  subagents: SubagentTracker;
  usage: TurnUsageTracker;
}
