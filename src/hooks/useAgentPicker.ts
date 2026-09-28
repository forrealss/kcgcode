/**
 * Logika bersama pemilih agent (mode) opencode: memuat daftar agent project
 * (lazy, sekali per komponen) + mengirim perubahan agent Session.
 *
 * Dipakai oleh `AgentPicker` (trigger + popover di desktop) dan langsung oleh
 * `SessionView` untuk daftar mode di Sheet aksi mobile — supaya tap satu mode
 * di Sheet tidak perlu buka popover lagi di dalam popover.
 */
import { useCallback, useRef, useState } from "react";
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
  /** null = Session belum ada (composer homepage): pilihan tidak di-PUT. */
  sessionId: string | null,
  onChanged: (agent: string | null) => void,
): UseAgentPickerResult {
  const [agents, setAgents] = useState<AgentOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Penanda fetch sedang berjalan — ref, BUKAN state `loading`. Bila `load`
   * bergantung pada `loading`, identitasnya berganti tiap fetch selesai, dan
   * efek pemanggil (`if (open) load()`) jalan lagi -> fetch tanpa henti
   * (spinner berkedip terus).
   */
  const inFlight = useRef(false);
  const saveInFlight = useRef(false);
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
        const res = await apiFetch(`/api/projects/${projectId}/agents`);
        const body = (await res.json()) as { agents: AgentOption[] };
        setAgents(body.agents);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to load agent list");
        setAgents([]);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    })();
  }, [projectId]);

  const pick = useCallback(
    async (name: string | null) => {
      if (saveInFlight.current) return;
      saveInFlight.current = true;
      setSaving(true);
      setError(null);
      try {
        if (sessionId !== null) {
          await apiFetch(`/api/sessions/${sessionId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agent: name }),
          });
        }
        onChangedRef.current(name);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to change agent");
      } finally {
        saveInFlight.current = false;
        setSaving(false);
      }
    },
    [sessionId],
  );

  return { agents, loading, saving, error, load, pick };
}
