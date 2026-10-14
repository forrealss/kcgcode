/**
 * Pilihan per Session: model, thinking effort, agent (mode), dan permission
 * mode. Model/effort/agent disimpan dan diterapkan ke agent sebelum tiap
 * prompt; permission mode diterapkan SEGERA bila client agent sudah siap.
 */
import type { AgentType, SessionModel } from "../../../types";
import type { SimpleResult } from "../../result";
import type { SessionRuntime } from "./runtime";
import { isEffortId, type SessionManager } from "./types";

export interface SessionSettingsDeps {
  rt: SessionRuntime;
  /** Capability agent Project (client dibuat bila perlu). */
  listCapabilities: (
    projectId: string,
    agentType?: AgentType,
  ) => ReturnType<SessionManager["listCapabilities"]>;
}

export function createSessionSettings({ rt, listCapabilities }: SessionSettingsDeps) {
  const { store } = rt;

  /** Ubah satu kolom pilihan Session yang sudah ada. */
  function updateChoice(sessionId: string, update: () => SimpleResult): SimpleResult {
    if (!store.getSession(sessionId).ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const upd = update();
    return upd.ok ? { ok: true } : { ok: false, error: upd.error };
  }

  /**
   * Ganti model pilihan Session. Berlaku untuk prompt berikutnya (model
   * diterapkan ke agent sebelum tiap prompt), jadi tidak perlu restart.
   */
  function setSessionModel(sessionId: string, model: SessionModel | null): SimpleResult {
    return updateChoice(sessionId, () => store.updateSessionModel(sessionId, model));
  }

  /**
   * Ganti thinking effort Session. Seperti model, diterapkan ke agent sebelum
   * tiap prompt; tingkat yang tidak didukung model diabaikan/di-clamp agent.
   */
  function setSessionEffort(sessionId: string, effort: string | null): SimpleResult {
    return updateChoice(sessionId, () =>
      effort !== null && !isEffortId(effort)
        ? { ok: false, error: "INVALID_EFFORT" }
        : store.updateSessionEffort(sessionId, effort),
    );
  }

  /**
   * Ganti agent (mode) pilihan Session. Berlaku untuk prompt berikutnya
   * (agent diterapkan sebelum tiap prompt).
   */
  function setSessionAgent(sessionId: string, agent: string | null): SimpleResult {
    return updateChoice(sessionId, () =>
      agent !== null && agent.trim() === ""
        ? { ok: false, error: "INVALID_AGENT" }
        : store.updateSessionAgent(sessionId, agent),
    );
  }

  /**
   * Ganti permission mode Session. Client agent yang sudah siap langsung
   * menerapkannya (juga di tengah turn — mis. pindah ke `plan` saat agent
   * mulai mengedit); tanpa client, mode diterapkan sebelum prompt berikutnya.
   * Kegagalan agent menerapkan mode tidak mengubah pilihan tersimpan.
   */
  async function setSessionPermissionMode(
    sessionId: string,
    mode: string | null,
  ): Promise<SimpleResult> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const caps = await listCapabilities(cur.data.projectId, cur.data.agentType);
    if (!caps.ok) return { ok: false, error: caps.error };
    if (caps.data.permissionModes.length === 0) {
      return { ok: false, error: "AGENT_PERMISSION_MODE_UNSUPPORTED" };
    }
    if (mode !== null && !caps.data.permissionModes.some((m) => m.id === mode)) {
      return { ok: false, error: "INVALID_PERMISSION_MODE" };
    }
    const client = rt.clientFor(cur.data.agentType, cur.data.projectId);
    if (client && cur.data.status === "running" && cur.data.ocSessionId) {
      const applied = await client.session.setPermissionMode(cur.data.ocSessionId, mode);
      if (!applied.ok) return applied;
    }
    return rt.updatePermissionMode(sessionId, mode);
  }

  return { setSessionModel, setSessionEffort, setSessionAgent, setSessionPermissionMode };
}
