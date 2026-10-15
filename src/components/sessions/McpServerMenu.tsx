/**
 * Menu aksi satu MCP server — Reconnect dan Enable/Disable — dipakai kartu
 * konteks Session (satu agent; seluruh baris jadi pemicu) dan panel samping
 * Project (bisa dua agent; pemicu tombol "⋯").
 *
 * Aksinya sesuai status per agent (`mcpActionsFor`): server nonaktif hanya
 * bisa diaktifkan. Server yang dipakai dua agent dikelompokkan per agent
 * (logo + status), karena status & kendalinya terpisah di tiap agent.
 * Selama aksi berjalan, item agent itu dikunci.
 */
import { PowerIcon, PowerOffIcon, RotateCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AGENT_TYPE_LABELS } from "@/lib/agent-types";
import {
  MCP_ACTION_LABEL,
  MCP_STATUS_LABEL,
  type McpAction,
  mcpActionsFor,
} from "@/lib/project-extensions";
import type { AgentType, McpStatus } from "@/types";

const ACTION_ICON: Record<McpAction, typeof PowerIcon> = {
  reconnect: RotateCwIcon,
  enable: PowerIcon,
  disable: PowerOffIcon,
};

/** Server di satu agent: status saat ini + aksi yang sedang berjalan. */
export interface McpMenuTarget {
  agent: AgentType;
  status: McpStatus;
  busy?: McpAction;
}

export interface McpServerMenuProps {
  name: string;
  targets: McpMenuTarget[];
  onAction: (agent: AgentType, action: McpAction) => void;
  /** Pemicu (`asChild`) — tombol baris atau tombol "⋯". */
  children: ReactNode;
}

export function McpServerMenu({ name, targets, onAction, children }: McpServerMenuProps) {
  const perAgent = targets.length > 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {name}
        </DropdownMenuLabel>
        {targets.map((t) => (
          <DropdownMenuGroup key={t.agent}>
            {perAgent && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                  <AgentLogo agentType={t.agent} className="size-3.5" />
                  {AGENT_TYPE_LABELS[t.agent]}
                  <span className="ml-auto font-normal text-muted-foreground">
                    {MCP_STATUS_LABEL[t.status]}
                  </span>
                </DropdownMenuLabel>
              </>
            )}
            {mcpActionsFor(t.status).map((action) => {
              const Icon = ACTION_ICON[action];
              return (
                <DropdownMenuItem
                  key={action}
                  disabled={t.busy !== undefined}
                  onSelect={() => onAction(t.agent, action)}
                >
                  <Icon />
                  {MCP_ACTION_LABEL[action]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
