/**
 * Session agent yang dibuat di luar KCG (Claude Desktop tab Code, `claude`
 * CLI, TUI / desktop opencode) untuk direktori Project yang sama: daftar
 * kandidat & impor.
 *
 * Impor = Session KCG biasa yang `ocSessionId`-nya menunjuk Session agent
 * tersebut, sehingga prompt berikutnya melanjutkan percakapan yang sama
 * (`resume` Claude Code / Session bersama di service opencode). Riwayatnya disalin sekali ke Session_Store agar timeline KCG
 * langsung terisi. Session yang masih terbuka di aplikasi lain hanya bisa
 * dilanjutkan sebagai salinan (`fork`) — dua penulis pada satu transcript
 * membuat riwayatnya bercabang.
 */
import { randomUUID } from "node:crypto";
import type { AgentType, Session } from "../../../types";
import type { AgentClient, AgentExternalSession } from "../../agents/types";
import type { Result } from "../../result";
import type { SessionRuntime } from "./runtime";
import type { CreateSessionResult } from "./types";

export interface ImportExternalSessionRequest {
  projectId: string;
  agentType: AgentType;
  /** id Session agent (UUID Session Claude Code, `ses_…` opencode). */
  externalId: string;
  /** Lanjutkan salinannya (wajib bila Session masih terbuka di tempat lain). */
  fork?: boolean;
}

export function createExternalSessions(rt: SessionRuntime) {
  const { store, now, clients, agentSessions } = rt;

  async function externalApi(
    projectId: string,
    agentType: AgentType,
  ): Promise<Result<{ client: AgentClient; external: NonNullable<AgentClient["external"]> }>> {
    if (!clients.isEnabled(agentType)) return { ok: false, error: "UNSUPPORTED_AGENT_TYPE" };
    const res = await rt.projectClient(projectId, agentType);
    if (!res.ok) return res;
    const external = res.data.external;
    if (!external) return { ok: false, error: "EXTERNAL_SESSIONS_UNSUPPORTED" };
    return { ok: true, data: { client: res.data, external } };
  }

  /** Id Session agent yang sudah dipakai Session KCG (jangan ditawarkan lagi). */
  function knownAgentIds(): Set<string> {
    return new Set(
      store
        .listSessions()
        .map((s) => s.ocSessionId)
        .filter((id): id is string => id !== null),
    );
  }

  async function listExternalSessions(
    projectId: string,
    agentType: AgentType,
  ): Promise<Result<AgentExternalSession[]>> {
    const api = await externalApi(projectId, agentType);
    if (!api.ok) return api;
    const res = await api.data.external.list();
    if (!res.ok) return res;
    const known = knownAgentIds();
    return { ok: true, data: res.data.filter((s) => !known.has(s.id)) };
  }

  async function importExternalSession(
    req: ImportExternalSessionRequest,
  ): Promise<CreateSessionResult> {
    // Sudah pernah diimpor -> Session yang sama (idempoten, mis. klik ganda).
    const existing = store.getSessionByOcId(req.externalId);
    if (existing.ok) return { ok: true, session: existing.data };

    const project = store.getProjectById(req.projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const api = await externalApi(req.projectId, req.agentType);
    if (!api.ok) return api;
    const { client, external } = api.data;

    const listed = await external.list();
    if (!listed.ok) return listed;
    const info = listed.data.find((s) => s.id === req.externalId);
    if (!info) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (info.openElsewhere && !req.fork) return { ok: false, error: "EXTERNAL_SESSION_OPEN" };

    // Riwayat dibaca SEBELUM fork: salinan berisi pesan yang sama.
    const history = await external.history(info.id);
    if (!history.ok) return history;

    let agentSessionId = info.id;
    if (req.fork) {
      const forked = await external.fork(info.id);
      if (!forked.ok) return forked;
      agentSessionId = forked.data.id;
    }
    // Daftarkan Session ke client agent (transcript ada -> prompt = resume).
    const remote = await client.session.get(agentSessionId);
    if (!remote.ok) return { ok: false, error: remote.error };

    const at = now();
    const session: Session = {
      id: randomUUID(),
      projectId: project.data.id,
      agentType: req.agentType,
      cwd: project.data.path,
      status: "running",
      ocSessionId: agentSessionId,
      title: info.title,
      model: null,
      effort: null,
      agent: null,
      permissionMode: null,
      createdAt: at,
      updatedAt: at,
    };
    const ins = store.insertSession(session);
    if (!ins.ok) return ins;
    for (const m of history.data) {
      const res = store.insertMessage({ ...m, sessionId: session.id });
      if (!res.ok) {
        // Jangan tinggalkan Session setengah terisi (transcript agent utuh).
        store.deleteSession(session.id);
        return { ok: false, error: res.error };
      }
    }
    agentSessions.map(agentSessionId, session.id);
    return { ok: true, session };
  }

  return { listExternalSessions, importExternalSession };
}
