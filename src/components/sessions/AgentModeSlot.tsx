/**
 * Slot "Mode" composer (Session maupun homepage): pemilih permission mode
 * untuk agent yang memilikinya (mis. Claude Code), pemilih agent untuk
 * lainnya (opencode). Kosong selama capability agent belum termuat (hindari
 * kedip).
 */
import { AgentPicker } from "@/components/sessions/AgentPicker";
import { PermissionModePicker } from "@/components/sessions/PermissionModePicker";
import type { UsePermissionModesResult } from "@/hooks/usePermissionModes";
import type { AgentType } from "@/types";

export interface AgentModeSlotProps {
  /** Hasil `usePermissionModes` — penentu pemilih yang tampil. */
  permissionPicker: UsePermissionModesResult;
  /** Permission mode aktif. */
  permissionMode: string | null;
  projectId: string;
  agentType: AgentType;
  /** null = belum ada Session (homepage): pilihan dikirim saat membuat Session. */
  sessionId: string | null;
  /** Agent (mode) terpilih; null = default. */
  agent: string | null;
  onAgentChange: (agent: string | null) => void;
  disabled: boolean;
}

export function AgentModeSlot({
  permissionPicker,
  permissionMode,
  projectId,
  agentType,
  sessionId,
  agent,
  onAgentChange,
  disabled,
}: AgentModeSlotProps) {
  if (permissionPicker.modes === null) return null;
  if (permissionPicker.modes.length > 0) {
    return (
      <PermissionModePicker picker={permissionPicker} active={permissionMode} disabled={disabled} />
    );
  }
  return (
    <AgentPicker
      projectId={projectId}
      agentType={agentType}
      sessionId={sessionId}
      agent={agent}
      onChanged={onAgentChange}
      disabled={disabled}
    />
  );
}
