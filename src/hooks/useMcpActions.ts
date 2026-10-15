/**
 * Aksi MCP server dari UI — aktif/nonaktif dan reconnect — untuk satu Project
 * (`POST /api/projects/:id/mcp/{toggle,reconnect}?agent=`).
 *
 * - Satu aksi per server (per agent) sekaligus; `busy` dipakai baris untuk
 *   menampilkan "Reconnecting…" dan mengunci menunya.
 * - Server membalas daftar MCP terbaru agent itu — JUGA saat gagal (mis.
 *   diaktifkan tapi tidak bisa tersambung) — dan diteruskan ke `onUpdated`
 *   agar status baris langsung berubah tanpa menunggu poll.
 * - Hasil dilaporkan lewat toast; pesan error agent ditampilkan apa adanya.
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { agentQuery } from "@/lib/agent-types";
import { ApiError, apiFetch, errorText } from "@/lib/api";
import { MCP_ACTION_DONE, type McpAction } from "@/lib/project-extensions";
import type { AgentType, McpServerInfo } from "@/types";

export interface UseMcpActionsResult {
  /** Aksi yang sedang berjalan untuk server ini (undefined = tidak ada). */
  busy(agent: AgentType, name: string): McpAction | undefined;
  run(agent: AgentType, name: string, action: McpAction): Promise<void>;
}

const key = (agent: AgentType, name: string) => `${agent}\u0000${name}`;

function serverList(body: unknown): McpServerInfo[] | null {
  const mcp = (body as { mcp?: unknown } | null)?.mcp;
  return Array.isArray(mcp) ? (mcp as McpServerInfo[]) : null;
}

export function useMcpActions(
  projectId: string,
  /** Daftar MCP terbaru agent setelah aksi (`null` = tidak terbaca, muat ulang sendiri). */
  onUpdated: (agent: AgentType, servers: McpServerInfo[] | null) => void,
): UseMcpActionsResult {
  const [running, setRunning] = useState<ReadonlyMap<string, McpAction>>(new Map());
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;

  const busy = useCallback(
    (agent: AgentType, name: string) => running.get(key(agent, name)),
    [running],
  );

  const run = useCallback(
    async (agent: AgentType, name: string, action: McpAction) => {
      const k = key(agent, name);
      setRunning((m) => new Map(m).set(k, action));
      const path = action === "reconnect" ? "reconnect" : "toggle";
      const body = action === "reconnect" ? { name } : { name, enabled: action === "enable" };
      try {
        const res = await apiFetch(`/api/projects/${projectId}/mcp/${path}${agentQuery(agent)}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        onUpdatedRef.current(agent, serverList(await res.json()));
        toast.success(`${MCP_ACTION_DONE[action]} ${name}`);
      } catch (e) {
        onUpdatedRef.current(agent, e instanceof ApiError ? serverList(e.body) : null);
        const message = errorText(e, "Couldn't reach the server.");
        toast.error(`${name}: ${message}`);
      } finally {
        setRunning((m) => {
          const next = new Map(m);
          next.delete(k);
          return next;
        });
      }
    },
    [projectId],
  );

  return { busy, run };
}
