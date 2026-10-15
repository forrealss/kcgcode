/**
 * Muat satu endpoint list untuk setiap agent (`?agent=`) bersamaan — dipakai
 * panel samping Project (MCP & Skills) dan halaman Skills (skill terpasang).
 *
 * - Error hanya bila SEMUA agent gagal; sebagian gagal -> `failed` (daftar
 *   dari agent lain tetap tampil).
 * - `reloadKey` berubah -> muat ulang. `path` null -> tidak memuat (`idle`).
 * - Fungsi kedua mengganti daftar satu agent di tempat (hasil aksi) tanpa
 *   memuat ulang semuanya.
 */
import { useCallback, useEffect, useState } from "react";
import { type AgentLists, collectAgentLists, replaceAgentList } from "@/lib/agent-lists";
import { AGENT_TYPES, agentQuery } from "@/lib/agent-types";
import { apiFetch } from "@/lib/api";
import type { IdleLoad, Load } from "@/lib/load-state";
import type { AgentType } from "@/types";

export interface UseAgentListsOptions {
  /**
   * Data `ready` lama tetap tampil selama dimuat ulang (tanpa kembali ke
   * skeleton). Default: kembali ke `loading` tiap muat ulang.
   */
  keepStale?: boolean;
  /** Pesan per agent bila error-nya bukan `ApiError`. */
  fallbackError?: string;
}

/** Ganti daftar satu agent di tempat. */
export type SetAgentList<T> = (agent: AgentType, items: T[]) => void;

export function useAgentLists<T>(
  path: string,
  key: string,
  reloadKey: number,
  options?: UseAgentListsOptions,
): [Load<AgentLists<T>>, SetAgentList<T>];
export function useAgentLists<T>(
  path: string | null,
  key: string,
  reloadKey: number,
  options?: UseAgentListsOptions,
): [IdleLoad<AgentLists<T>>, SetAgentList<T>];
export function useAgentLists<T>(
  path: string | null,
  key: string,
  reloadKey: number,
  { keepStale = false, fallbackError = "Failed to load" }: UseAgentListsOptions = {},
): [IdleLoad<AgentLists<T>>, SetAgentList<T>] {
  const [state, setState] = useState<IdleLoad<AgentLists<T>>>(() =>
    path === null ? { phase: "idle" } : { phase: "loading" },
  );
  useEffect(() => {
    // `reloadKey` hanya pemicu muat ulang.
    void reloadKey;
    if (path === null) return;
    let cancelled = false;
    setState((prev) => (keepStale && prev.phase === "ready" ? prev : { phase: "loading" }));
    void Promise.allSettled(
      AGENT_TYPES.map((a) =>
        apiFetch(`${path}${agentQuery(a)}`).then(async (res) => {
          const body = (await res.json()) as Record<string, T[]>;
          return body[key] ?? [];
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const data = collectAgentLists(results, fallbackError);
      if (data.failed.length === AGENT_TYPES.length) {
        setState({ phase: "error", message: data.failed[0]?.message ?? fallbackError });
      } else {
        setState({ phase: "ready", data });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, key, reloadKey, keepStale, fallbackError]);
  const setList = useCallback((agent: AgentType, items: T[]) => {
    setState((cur) =>
      cur.phase === "ready"
        ? { phase: "ready", data: replaceAgentList(cur.data, agent, items) }
        : cur,
    );
  }, []);
  return [state, setList];
}
