/**
 * Logika bersama pemilih agent (mode) opencode: memuat daftar agent project
 * (lazy, sekali per komponen) + mengirim perubahan agent Session.
 *
 * Dipakai oleh `AgentPicker` (trigger + popover di desktop) dan langsung oleh
 * `SessionView` untuk daftar mode di Sheet aksi mobile — supaya tap satu mode
 * di Sheet tidak perlu buka popover lagi di dalam popover.
 */
import { useCallback, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import type { AgentOption } from "@/server/services/opencode-client";

export interface UseAgentPickerResult {
  agents: AgentOption[] | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Muat daftar agent project (no-op bila sudah dimuat / sedang memuat). */
  load: () => void;
  /** Ganti agent Session; `null` = kembali ke default opencode. */
  pick: (name: string | null) => Promise<void>;
}

export function useAgentPicker(
  projectId: string,
  sessionId: string,
  onChanged: (agent: string | null) => void,
): UseAgentPickerResult {
  const [agents, setAgents] = useState<AgentOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (agents !== null || loading) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/agents`);
        const body = (await res.json()) as { agents: AgentOption[] };
        setAgents(body.agents);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to load agent list");
        setAgents([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [agents, loading, projectId]);

  const pick = useCallback(
    async (name: string | null) => {
      if (saving) return;
      setSaving(true);
      setError(null);
      try {
        await apiFetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent: name }),
        });
        onChanged(name);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to change agent");
      } finally {
        setSaving(false);
      }
    },
    [onChanged, saving, sessionId],
  );

  return { agents, loading, saving, error, load, pick };
}
