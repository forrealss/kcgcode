/**
 * Bentuk baris SQLite & pemetaan ke tipe domain (shared antar repository).
 * Internal data-layer — tidak untuk dipakai luar `server/db`.
 */
import type {
  InteractivePrompt,
  MessagePart,
  Project,
  PromptStatus,
  Session,
  SessionMessage,
  SessionModel,
  SessionStatus,
} from "../../types";

/** Hasil gagal seragam `{ ok: false; error }`. */
export function errResult(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: number;
}

export interface SessionRow {
  id: string;
  project_id: string;
  agent_type: string;
  cwd: string;
  status: string;
  oc_session_id: string | null;
  model: string | null;
  agent: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
}

export interface PromptRow {
  id: string;
  session_id: string;
  kind: string;
  type: string;
  custom: number;
  title: string | null;
  options_json: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

export interface MessageRow {
  session_id: string;
  message_id: string;
  role: string;
  parts_json: string;
  created_at: number;
}

export function mapProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, path: r.path, createdAt: r.created_at };
}

/**
 * Parse kolom `sessions.model` (JSON) -> SessionModel.
 * Nilai NULL/korup/tidak lengkap dianggap "pakai model default" (null).
 */
export function parseModel(raw: string | null): SessionModel | null {
  if (raw === null || raw === "") return null;
  try {
    const obj = JSON.parse(raw) as { providerID?: unknown; modelID?: unknown } | null;
    if (obj && typeof obj.providerID === "string" && typeof obj.modelID === "string") {
      return { providerID: obj.providerID, modelID: obj.modelID };
    }
  } catch {
    /* data korup -> default */
  }
  return null;
}

export function mapSession(r: SessionRow): Session {
  return {
    id: r.id,
    projectId: r.project_id,
    agentType: r.agent_type as Session["agentType"],
    cwd: r.cwd,
    status: r.status as SessionStatus,
    ocSessionId: r.oc_session_id,
    model: parseModel(r.model),
    agent: r.agent ?? null,
    title: r.title ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapPrompt(r: PromptRow): InteractivePrompt {
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: (r.kind as InteractivePrompt["kind"]) ?? "permission",
    type: r.type as InteractivePrompt["type"],
    custom: r.custom === 1,
    title: r.title,
    options: r.options_json ? (JSON.parse(r.options_json) as string[]) : null,
    status: r.status as PromptStatus,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

export function mapMessage(r: MessageRow): SessionMessage {
  return {
    id: r.message_id,
    sessionId: r.session_id,
    role: r.role as SessionMessage["role"],
    parts: JSON.parse(r.parts_json) as MessagePart[],
    createdAt: r.created_at,
  };
}
