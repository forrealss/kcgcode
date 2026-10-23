/**
 * Daftar model satu agent di Project (`GET /api/projects/:id/models?agent=`)
 * — dipakai dialog New Session dan `ModelPicker`.
 *
 * Selalu dimuat ulang tiap `enabled` menyala (dialog dibuka) / agent
 * berganti, agar perubahan config agent terlihat tanpa reload halaman;
 * lazy: server headless tidak di-spawn selama dialog belum dibuka.
 * Respons usang (agent sudah diganti lagi) dibuang.
 */
import { useRef } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { agentQuery } from "@/lib/agent-types";
import type { AgentType, ModelOption } from "@/types";

export interface ModelList {
  /** Daftar terakhir yang termuat (tetap ada saat dimuat ulang / dialog ditutup); `[]` bila gagal. */
  models: ModelOption[] | null;
  loading: boolean;
  error: string | null;
}

const selectModels = async (res: Response) =>
  ((await res.json()) as { models: ModelOption[] }).models;

export function useModelList(
  projectId: string,
  agentType: AgentType,
  enabled: boolean,
  errorMessage = "Failed to load models",
): ModelList {
  const [state] = useApiQuery(
    enabled ? `/api/projects/${projectId}/models${agentQuery(agentType)}` : null,
    { select: selectModels, errorMessage },
  );
  const last = useRef<ModelOption[] | null>(null);
  if (state.phase === "ready") last.current = state.data;
  else if (state.phase === "error") last.current = [];
  return {
    models: last.current,
    loading: state.phase === "loading",
    error: state.phase === "error" ? state.message : null,
  };
}
