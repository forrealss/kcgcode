/** State satu Session Claude Code yang dikelola client in-process. */
import type { EffortLevel, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContextUsage, TodoItem } from "../../../types";
import type { AgentError, AgentEvent } from "../types";
import type { ClaudeQueryLike, InputQueue } from "./sdk";
import { ClaudeTurnTranslator } from "./translate";
import type { UsageTotals } from "./usage";

/** Satu Session Claude Code (id = UUID session Claude Code). */
export interface LiveSession {
  id: string;
  query: ClaudeQueryLike | null;
  input: InputQueue<SDKUserMessage> | null;
  translator: ClaudeTurnTranslator;
  /** Model / effort / mode / instruksi yang berlaku pada proses aktif. */
  model: string | null;
  effort: EffortLevel | null;
  mode: string | null;
  system: string | null;
  /** Pilihan untuk prompt berikutnya (`session.switchModel/setPermissionMode/instructions`). */
  wantModel: string | null;
  wantEffort: EffortLevel | null;
  wantMode: string | null;
  /** Mode yang terakhir dilaporkan CLI (`system/init` / `system/status`). */
  reportedMode: string | null;
  wantSystem: string | null;
  /** Transcript sudah ada di disk -> proses berikutnya pakai `resume`. */
  persisted: boolean;
  /** Turn sedang berjalan (dari `session_state_changed`). */
  running: boolean;
  /** CLI memancarkan `session_state_changed` (bila tidak: fallback `result`). */
  sawState: boolean;
  /** Idle berikutnya milik turn yang di-interrupt — jangan tutup turn baru. */
  skipNextIdle: boolean;
  /** Selesai saat turn yang di-interrupt benar-benar berhenti (idle). */
  interruptSettled: { promise: Promise<void>; resolve: () => void } | null;
  /** Error turn pertama (dilaporkan saat turn ditutup). */
  turnError: AgentError | null;
  /** Proses sengaja ditutup (bukan crash). */
  closing: boolean;
  todos: TodoItem[];
  /** Pemakaian context window terakhir (bertahan walau proses ditutup). */
  usage: ContextUsage | null;
  /** Pengukuran pemakaian sedang berjalan (cegah request ganda). */
  usageInFlight: Promise<void> | null;
  /** Compact sedang berjalan + pemicunya. */
  compacting: "manual" | "auto" | null;
  /** Prompt terakhir adalah `/compact` (compact berikutnya = manual). */
  manualCompact: boolean;
  /** Total kumulatif pemakaian proses aktif (dasar selisih per turn). */
  usageBase: UsageTotals | null;
  /** Proses aktif melanjutkan transcript dengan total yang belum diketahui. */
  usageBaseUnknown: boolean;
  /** Task sub-agent (`task_id` -> tool call `Agent`). */
  taskTools: Map<string, string>;
  /** Task latar belakang yang masih berjalan (proses jangan ditutup). */
  backgroundTasks: Set<string>;
  stderr: string[];
  idleTimer: unknown;
  /** Selesai saat stream proses aktif berakhir (proses keluar). */
  pumpDone: Promise<void> | null;
}

export function createLiveSession(
  id: string,
  persisted: boolean,
  emit: (ev: AgentEvent) => void,
): LiveSession {
  return {
    id,
    query: null,
    input: null,
    translator: new ClaudeTurnTranslator(id, emit),
    model: null,
    effort: null,
    mode: null,
    system: null,
    wantModel: null,
    wantEffort: null,
    wantMode: null,
    reportedMode: null,
    wantSystem: null,
    persisted,
    running: false,
    sawState: false,
    skipNextIdle: false,
    interruptSettled: null,
    turnError: null,
    closing: false,
    todos: [],
    usage: null,
    usageInFlight: null,
    compacting: null,
    manualCompact: false,
    usageBase: null,
    usageBaseUnknown: false,
    taskTools: new Map(),
    backgroundTasks: new Set(),
    stderr: [],
    idleTimer: undefined,
    pumpDone: null,
  };
}

/** Tandai turn yang di-interrupt sudah benar-benar berhenti. */
export function settleInterrupt(live: LiveSession): void {
  live.skipNextIdle = false;
  live.interruptSettled?.resolve();
  live.interruptSettled = null;
}

/** Mulai menunggu turn yang di-interrupt berhenti (idempoten). */
export function beginInterrupt(live: LiveSession): void {
  live.skipNextIdle = true;
  if (live.interruptSettled) return;
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  live.interruptSettled = { promise, resolve };
}

/** Beberapa baris stderr terakhir (detail pesan crash). */
export function stderrTail(live: LiveSession): string {
  return live.stderr.slice(-5).join("\n").trim();
}
