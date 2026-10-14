/**
 * Menyambungkan `AgentEventProjector` ke state Session_Manager: resolusi id
 * Session agent, penanda Session akar, pemetaan child sub-agent, serta
 * perubahan permission mode / compact / judul yang dipicu event agent.
 */
import type { SessionStore } from "../../../db";
import type { SimpleResult } from "../../result";
import { AgentEventProjector } from "../agent-projector";
import type { TurnStream } from "../turn-stream";
import type { AgentSessionMap } from "./agent-session-map";
import type { SessionManagerOptions } from "./types";

export interface SessionProjectorDeps {
  opts: SessionManagerOptions;
  store: SessionStore;
  turns: TurnStream;
  now: () => number;
  agentSessions: AgentSessionMap;
  /** Session lokal yang sedang compact — diubah lewat `setCompacting`. */
  compacting: Set<string>;
  beginTurn: (sessionId: string) => void;
  updateTitle: (sessionId: string, title: string) => void;
  updatePermissionMode: (sessionId: string, mode: string | null) => SimpleResult;
}

/** Proyeksi event agent ke part pesan, kartu prompt, dan judul Session. */
export function createSessionProjector(deps: SessionProjectorDeps): AgentEventProjector {
  const { opts, store, turns, now, agentSessions, compacting } = deps;
  return new AgentEventProjector({
    turns,
    now,
    resolve: (agentSessionID) => agentSessions.resolve(agentSessionID),
    // Hanya Session AKAR yang menandai akhir turn & judul percakapan —
    // sub-agent selesai lebih dulu dari induknya.
    isRoot: (sessionId, agentSessionID) => {
      const cur = store.getSession(sessionId);
      return cur.ok && cur.data.ocSessionId === agentSessionID;
    },
    mapChild: (childID, sessionId) => agentSessions.map(childID, sessionId),
    setPermissionMode: (sessionId, mode) => {
      const cur = store.getSession(sessionId);
      if (!cur.ok || cur.data.permissionMode === mode) return;
      deps.updatePermissionMode(sessionId, mode);
    },
    // Eksekusi yang dimulai agent sendiri (mis. dibangunkan hasil sub-agent
    // latar belakang) — turn dibuka agar kontennya tidak terbuang.
    beginTurn: (sessionId) => {
      if (!turns.has(sessionId)) deps.beginTurn(sessionId);
    },
    setCompacting: (sessionId, on) => {
      if (compacting.has(sessionId) === on) return;
      if (on) compacting.add(sessionId);
      else compacting.delete(sessionId);
      opts.onCompactionChange?.(sessionId, on);
    },
    setTitle: (sessionId, title) => {
      const cur = store.getSession(sessionId);
      if (!cur.ok || cur.data.title === title) return;
      deps.updateTitle(sessionId, title);
    },
    insertPrompt: (prompt) => store.insertPrompt(prompt).ok,
    onPrompt: opts.onPrompt,
    onError: opts.onError,
  });
}
