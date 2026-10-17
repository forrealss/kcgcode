/**
 * Runtime bersama Session_Manager: state mutable yang dipakai seluruh modul
 * operasi (Session yang sedang compact, pemetaan id Session agent, client
 * agent per Project, turn streaming, refresh skill, proyektor event) beserta
 * helper tulis-store + hook. Dibuat sekali per Session_Manager lalu
 * diteruskan eksplisit ke tiap modul — tidak ada state global tersembunyi.
 */
import type { SessionStore } from "../../../db";
import type { AgentType, Session, SessionStatus } from "../../../types";
import type { AgentClient } from "../../agents/types";
import type { Result, SimpleResult } from "../../result";
import type { AgentEventProjector } from "../agent-projector";
import type { AttachmentManager } from "../attachments";
import { friendlySendError } from "../session-events";
import { TurnStream } from "../turn-stream";
import { AgentClients } from "./agent-clients";
import { AgentSessionMap } from "./agent-session-map";
import { createSessionProjector } from "./projector-wiring";
import { SkillRefresher } from "./skill-refresh";
import { type SessionManagerOptions, SHUTDOWN_BUDGET_MS, TURN_IDLE_TIMEOUT_MS } from "./types";

export interface SessionRuntime {
  readonly store: SessionStore;
  readonly attachments: AttachmentManager | undefined;
  readonly now: () => number;
  readonly shutdownBudgetMs: number;
  readonly setTimeoutFn: (cb: () => void, ms: number) => unknown;
  readonly clearTimeoutFn: (handle: unknown) => void;
  readonly onMessage: SessionManagerOptions["onMessage"];
  readonly extraInstructions: SessionManagerOptions["extraInstructions"];
  readonly onDeleted: SessionManagerOptions["onDeleted"];
  /** Session lokal yang riwayatnya sedang diringkas agent (compact). */
  readonly compacting: Set<string>;
  readonly agentSessions: AgentSessionMap;
  readonly clients: AgentClients;
  /** State turn streaming per Session (finish/discard/fail + timer idle). */
  readonly turns: TurnStream;
  readonly skills: SkillRefresher;
  readonly projector: AgentEventProjector;
  /** Client agent Project yang sudah siap (tanpa membuat baru). */
  clientFor(agentType: AgentType, projectId: string): AgentClient | undefined;
  /** Client agent Project (dibuat bila perlu). */
  projectClient(projectId: string, agentType: AgentType): Promise<Result<AgentClient>>;
  beginTurn(sessionId: string): void;
  updateStatus(sessionId: string, status: SessionStatus, changedAt: number): void;
  updateTitle(sessionId: string, title: string): void;
  updatePermissionMode(sessionId: string, mode: string | null): SimpleResult;
  /** Interrupt turn remote Session (best-effort, tidak menunggu). */
  interruptRemote(session: Session): void;
}

export function createSessionRuntime(opts: SessionManagerOptions): SessionRuntime {
  const store = opts.store;
  const attachments = opts.attachments;
  const now = opts.now ?? Date.now;
  const shutdownBudgetMs = opts.shutdownBudgetMs ?? SHUTDOWN_BUDGET_MS;
  const turnIdleTimeoutMs = opts.turnIdleTimeoutMs ?? TURN_IDLE_TIMEOUT_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const { onMessage, onStatusChange, onTitleChange, onPermissionModeChange, onDeleted } = opts;

  /** Session lokal yang riwayatnya sedang diringkas agent (compact). */
  const compacting = new Set<string>();
  const agentSessions = new AgentSessionMap();

  const clients = new AgentClients({
    store,
    backends: opts.backends,
    onEvent: (ev) => projector.handle(ev),
  });
  const clientFor = (agentType: AgentType, projectId: string) => clients.get(agentType, projectId);
  const projectClient = (projectId: string, agentType: AgentType) =>
    clients.forProject(projectId, agentType);

  /** State turn streaming per Session (finish/discard/fail + timer idle). */
  const turns = new TurnStream({
    store,
    now,
    onMessage,
    onMessagePart: opts.onMessagePart,
    onMessagePartDelta: opts.onMessagePartDelta,
    onError: opts.onError,
    onTurnChange: (sessionId, active) => {
      opts.onTurnChange?.(sessionId, active);
      skills.onTurnChange(sessionId, active);
    },
    onTurnEnd: opts.onTurnEnd,
    // Turn menunggu keputusan user (kartu permission/question pending) bukan
    // keheningan — timer idle ditunda sampai kartu dijawab atau turn ditutup.
    shouldFireIdle: (sessionId) => store.listPendingPrompts(sessionId).length === 0,
    setTimeoutFn,
    clearTimeoutFn,
  });

  const skills = new SkillRefresher({
    store,
    clientFor,
    hasTurn: (sessionId) => turns.has(sessionId),
    delayMs: opts.skillRefreshDelayMs,
    setTimeoutFn,
    clearTimeoutFn,
    onRefreshed: opts.onSkillsRefreshed,
  });

  function beginTurn(sessionId: string): void {
    turns.begin(sessionId, turnIdleTimeoutMs, friendlySendError("TURN_TIMEOUT"));
  }

  function updateStatus(sessionId: string, status: SessionStatus, changedAt: number): void {
    const res = store.updateSessionStatus(sessionId, status, changedAt);
    if (res.ok) onStatusChange?.(sessionId, status);
  }

  function updateTitle(sessionId: string, title: string): void {
    if (store.updateSessionTitle(sessionId, title).ok) onTitleChange?.(sessionId, title);
  }

  function updatePermissionMode(sessionId: string, mode: string | null): SimpleResult {
    const upd = store.updateSessionPermissionMode(sessionId, mode);
    if (!upd.ok) return { ok: false, error: upd.error };
    onPermissionModeChange?.(sessionId, mode);
    return { ok: true };
  }

  /** Interrupt turn remote Session (best-effort, tidak menunggu). */
  function interruptRemote(session: Session): void {
    if (!session.ocSessionId) return;
    void clientFor(session.agentType, session.projectId)?.session.interrupt(session.ocSessionId);
  }

  /** Proyeksi event agent ke part pesan, kartu prompt, dan judul Session. */
  const projector = createSessionProjector({
    opts,
    store,
    turns,
    now,
    agentSessions,
    compacting,
    beginTurn,
    updateTitle,
    updatePermissionMode,
  });

  return {
    store,
    attachments,
    now,
    shutdownBudgetMs,
    setTimeoutFn,
    clearTimeoutFn,
    onMessage,
    extraInstructions: opts.extraInstructions,
    onDeleted,
    compacting,
    agentSessions,
    clients,
    turns,
    skills,
    projector,
    clientFor,
    projectClient,
    beginTurn,
    updateStatus,
    updateTitle,
    updatePermissionMode,
    interruptRemote,
  };
}
