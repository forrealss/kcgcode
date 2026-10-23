/**
 * Permission mode agent (capability `permissionModes`, mis. Claude Code):
 * memuat daftar mode dari `GET /api/projects/:id/capabilities` dan mengirim
 * pilihan lewat `PUT /api/sessions/:id` (`permissionMode`) — berlaku segera,
 * juga di tengah balasan yang sedang berjalan.
 *
 * Daftar dimuat saat mount (dan di-cache per Project + agent) karena
 * menentukan kontrol mana yang tampil di composer: agent tanpa permission
 * mode (opencode) memakai pemilih agent biasa.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionSettingSaver } from "@/hooks/useSessionSettingSaver";
import { agentQuery } from "@/lib/agent-types";
import { apiFetch } from "@/lib/api";
import type { AgentCapabilitiesInfo, AgentType, PermissionModeOption } from "@/types";

/** Cache capability per `projectId|agentType` (statis selama aplikasi hidup). */
const capabilityCache = new Map<string, Promise<AgentCapabilitiesInfo>>();

function loadCapabilities(projectId: string, agentType: AgentType): Promise<AgentCapabilitiesInfo> {
  const key = `${projectId}|${agentType}`;
  let p = capabilityCache.get(key);
  if (!p) {
    p = apiFetch(`/api/projects/${projectId}/capabilities${agentQuery(agentType)}`)
      .then((res) => res.json() as Promise<{ capabilities: AgentCapabilitiesInfo }>)
      .then((body) => body.capabilities);
    // Gagal -> boleh dicoba lagi (agent belum siap, koneksi putus, …).
    p.catch(() => capabilityCache.delete(key));
    capabilityCache.set(key, p);
  }
  return p;
}

export interface UsePermissionModesResult {
  /** null = belum dimuat; [] = agent tidak punya permission mode. */
  modes: PermissionModeOption[] | null;
  saving: boolean;
  error: string | null;
  /** Ganti permission mode Session; `null` = default settings agent. */
  pick: (mode: string | null) => Promise<void>;
}

export function usePermissionModes(
  projectId: string,
  agentType: AgentType,
  /** null = Session belum ada (composer homepage): pilihan tidak di-PUT. */
  sessionId: string | null,
  onChanged: (mode: string | null) => void,
): UsePermissionModesResult {
  const [modes, setModes] = useState<PermissionModeOption[] | null>(null);
  const { saving, error, save } = useSessionSettingSaver(sessionId);
  /** Callback terbaru via ref — pemanggil sering mengoper arrow function inline. */
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    let alive = true;
    setModes(null);
    loadCapabilities(projectId, agentType).then(
      (caps) => alive && setModes(caps.permissionModes),
      // Capability tak terbaca -> perlakukan sebagai tanpa permission mode
      // (pemilih agent biasa tetap tampil).
      () => alive && setModes([]),
    );
    return () => {
      alive = false;
    };
  }, [projectId, agentType]);

  const pick = useCallback(
    async (mode: string | null) => {
      await save(
        { permissionMode: mode },
        () => onChangedRef.current(mode),
        "Failed to change permission mode",
      );
    },
    [save],
  );

  return { modes, saving, error, pick };
}
