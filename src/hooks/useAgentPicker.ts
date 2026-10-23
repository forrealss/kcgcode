/**
 * Logika bersama pemilih agent (mode) opencode: memuat daftar agent project
 * (lazy, sekali per komponen) + mengirim perubahan agent Session.
 *
 * Dipakai oleh `AgentPicker` (trigger + popover di desktop) dan langsung oleh
 * `SessionView` untuk daftar mode di Sheet aksi mobile — supaya tap satu mode
 * di Sheet tidak perlu buka popover lagi di dalam popover.
 */
import { useCallback, useRef, useState } from "react";
import { useSessionSettingSaver } from "@/hooks/useSessionSettingSaver";
import { agentQuery } from "@/lib/agent-types";
import { apiFetch, errorText } from "@/lib/api";
import type { AgentOption, AgentType } from "@/types";

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
  /** null = Session belum ada (composer homepage): pilihan tidak di-PUT. */
  sessionId: string | null,
  onChanged: (agent: string | null) => void,
  /** Backend Session — Claude Code menawarkan mode permission sebagai agent. */
  agentType: AgentType = "opencode",
): UseAgentPickerResult {
  const [agents, setAgents] = useState<AgentOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Error simpan & error muat daftar berbagi satu pesan.
  const { saving, error, setError, save } = useSessionSettingSaver(sessionId);
  /**
   * Penanda fetch sedang berjalan — ref, BUKAN state `loading`. Bila `load`
   * bergantung pada `loading`, identitasnya berganti tiap fetch selesai, dan
   * efek pemanggil (`if (open) load()`) jalan lagi -> fetch tanpa henti
   * (spinner berkedip terus).
   */
  const inFlight = useRef(false);
  /** Callback terbaru via ref — pemanggil sering mengoper arrow function inline. */
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  /**
   * Muat daftar agent project. Selalu fetch ulang (no-op bila sedang memuat)
   * — config opencode bisa berubah dan server headless tidak hot-reload.
   * Identitas stabil per `projectId`.
   */
  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/agents${agentQuery(agentType)}`);
        const body = (await res.json()) as { agents: AgentOption[] };
        setAgents(body.agents);
      } catch (e) {
        setError(errorText(e, "Failed to load agent list"));
        setAgents([]);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    })();
  }, [projectId, agentType, setError]);

  const pick = useCallback(
    async (name: string | null) => {
      await save({ agent: name }, () => onChangedRef.current(name), "Failed to change agent");
    },
    [save],
  );

  return { agents, loading, saving, error, load, pick };
}
