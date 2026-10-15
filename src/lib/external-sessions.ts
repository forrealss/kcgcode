/**
 * Session agent yang dibuat di luar KCG (Claude Desktop / `claude` CLI, TUI /
 * desktop opencode): panggilan REST impor, penggabungan daftar tiap agent,
 * dan label asal Session (teruji lewat `bun test`).
 */
import { AGENT_TYPE_LABELS, AGENT_TYPES } from "@/lib/agent-types";
import { ApiError, apiFetch, errorText } from "@/lib/api";
import type { AgentType, ExternalSession, Session } from "@/types";

/** Kandidat impor beserta agent pemiliknya. */
export interface ExternalSessionItem extends ExternalSession {
  agentType: AgentType;
}

/** Hasil muat daftar semua agent. */
export interface ExternalSessionsLoad {
  /** Gabungan semua agent, terbaru dulu. */
  sessions: ExternalSessionItem[];
  /** Agent yang mendukung impor di Project ini (tidak dimatikan / terpasang). */
  agents: AgentType[];
  /** Agent yang gagal dimuat (selain "tidak tersedia"). */
  errors: { agentType: AgentType; message: string }[];
}

export type ExternalSessionsResult =
  | { agentType: AgentType; sessions: ExternalSession[] }
  | { agentType: AgentType; error: unknown };

/**
 * Error yang berarti agent tidak bisa menawarkan Session luar di sini
 * (dimatikan, tidak terpasang, versi lama) -> agent dilewati tanpa banner.
 */
function isUnavailable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return (
    e.code === "UNSUPPORTED_AGENT_TYPE" ||
    e.code === "EXTERNAL_SESSIONS_UNSUPPORTED" ||
    e.code === "OPENCODE_NOT_FOUND" ||
    e.code.startsWith("OPENCODE_UPGRADE_REQUIRED")
  );
}

/** Gabungkan hasil per agent (urutan stabil untuk `updatedAt` yang sama). */
export function mergeExternalSessions(results: ExternalSessionsResult[]): ExternalSessionsLoad {
  const out: ExternalSessionsLoad = { sessions: [], agents: [], errors: [] };
  for (const r of results) {
    if ("sessions" in r) {
      out.agents.push(r.agentType);
      out.sessions.push(...r.sessions.map((s) => ({ ...s, agentType: r.agentType })));
    } else if (!isUnavailable(r.error)) {
      out.agents.push(r.agentType);
      out.errors.push({
        agentType: r.agentType,
        message: errorText(r.error, `Failed to load ${AGENT_TYPE_LABELS[r.agentType]} sessions`),
      });
    }
  }
  out.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

async function listFor(projectId: string, agentType: AgentType): Promise<ExternalSession[]> {
  const res = await apiFetch(`/api/projects/${projectId}/external-sessions?agent=${agentType}`);
  return ((await res.json()) as { sessions: ExternalSession[] }).sessions;
}

/** Kandidat impor semua agent untuk Project (yang sudah ada di KCG tidak ikut). */
export async function listExternalSessions(projectId: string): Promise<ExternalSessionsLoad> {
  const results = await Promise.all(
    AGENT_TYPES.map(async (agentType): Promise<ExternalSessionsResult> => {
      try {
        return { agentType, sessions: await listFor(projectId, agentType) };
      } catch (error) {
        return { agentType, error };
      }
    }),
  );
  return mergeExternalSessions(results);
}

/**
 * Impor Session sebagai Session KCG (riwayat ikut disalin). Session yang
 * masih terbuka / berjalan di aplikasi lain dilanjutkan sebagai salinan
 * (`fork`).
 */
export async function importExternalSession(
  projectId: string,
  session: ExternalSessionItem,
): Promise<Session> {
  const res = await apiFetch(`/api/projects/${projectId}/external-sessions`, {
    method: "POST",
    body: JSON.stringify({
      id: session.id,
      agentType: session.agentType,
      fork: session.openElsewhere,
    }),
  });
  return ((await res.json()) as { session: Session }).session;
}

/** Nama aplikasi asal untuk label ("Claude Desktop", "Claude Code CLI", "OpenCode"). */
export function externalSourceLabel(session: ExternalSession): string {
  if (session.source === "claude-desktop") return "Claude Desktop";
  if (session.source === "cli") return "Claude Code CLI";
  if (session.source === "opencode") return "OpenCode";
  return "Claude Code";
}

/**
 * Status Session yang hanya bisa dilanjutkan sebagai salinan: Claude Code =
 * masih terbuka di Desktop/CLI; opencode = sedang menjalankan balasan.
 */
export function externalBusyLabel(session: ExternalSessionItem): string {
  const source = externalSourceLabel(session);
  return session.agentType === "opencode" ? `Running in ${source}` : `Open in ${source}`;
}

/** Ringkasan tab "Other agents" ("24 sessions · 5 open elsewhere"). */
export function describeExternalSummary(sessions: readonly ExternalSession[]): string {
  const total = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;
  const busy = sessions.filter((s) => s.openElsewhere).length;
  return busy > 0 ? `${total} · ${busy} open elsewhere` : total;
}
