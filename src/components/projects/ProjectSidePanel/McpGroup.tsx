/**
 * Grup "MCP servers" panel samping Project: server dari kedua agent digabung
 * per nama, status per agent di subjudul, menu aksi per server.
 */
import { MoreHorizontalIcon, PlugIcon, RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { McpServerMenu } from "@/components/sessions/McpServerMenu";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { UseMcpActionsResult } from "@/hooks/useMcpActions";
import type { AgentLists } from "@/lib/agent-lists";
import { AGENT_TYPE_LABELS } from "@/lib/agent-types";
import type { Load } from "@/lib/load-state";
import {
  describeMcpEntries,
  MCP_ACTION_PROGRESS,
  MCP_STATUS_LABEL,
  type McpServerEntry,
  mergeMcpServers,
} from "@/lib/project-extensions";
import { cn } from "@/lib/utils";
import type { AgentType, McpServerInfo, McpServerState } from "@/types";
import { ErrorRow, FlatIconButton, PartialFailureRow, SkeletonRows } from "./rows";

/** Warna teks status MCP per agent. */
const MCP_TEXT: Record<McpServerState["status"], string> = {
  connected: "text-emerald-700 dark:text-emerald-400",
  pending: "text-sky-700 dark:text-sky-400",
  failed: "text-destructive",
  needs_auth: "text-amber-700 dark:text-amber-400",
  needs_client_registration: "text-amber-700 dark:text-amber-400",
  disabled: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

/** Warna ikon baris = status paling bermasalah. */
const MCP_ICON: Record<McpServerState["status"], string> = {
  connected: "text-emerald-600 dark:text-emerald-400",
  pending: "text-sky-600 dark:text-sky-400",
  failed: "text-destructive",
  needs_auth: "text-amber-600 dark:text-amber-400",
  needs_client_registration: "text-amber-600 dark:text-amber-400",
  disabled: "text-muted-foreground/60",
  unknown: "text-muted-foreground",
};

/**
 * Label status per agent. `unknown` di Claude Code berarti status belum
 * pernah dilaporkan proses `claude` (server dibaca dari config).
 */
function mcpAgentLabel(agent: AgentType, status: McpServerState["status"]): string {
  if (agent === "claude-code" && status === "unknown") return "Not checked";
  return MCP_STATUS_LABEL[status];
}

export function McpGroup({
  state,
  onReload,
  actions,
}: {
  state: Load<AgentLists<McpServerInfo>>;
  onReload: () => void;
  actions: UseMcpActionsResult;
}) {
  const entries = useMemo(
    () => (state.phase === "ready" ? mergeMcpServers(state.data.byAgent) : []),
    [state],
  );

  return (
    <PrefsGroup
      title="MCP servers"
      description={state.phase === "ready" ? describeMcpEntries(entries) : "Loading…"}
      suffix={
        <FlatIconButton
          label="Refresh MCP status"
          onClick={onReload}
          disabled={state.phase === "loading"}
        >
          <RefreshCwIcon className={cn(state.phase === "loading" && "animate-spin")} />
        </FlatIconButton>
      }
    >
      {state.phase === "loading" ? (
        <SkeletonRows rows={2} />
      ) : state.phase === "error" ? (
        <ErrorRow message={state.message} onRetry={onReload} />
      ) : (
        <>
          {entries.length === 0 ? (
            <ActionRow
              title="No MCP servers"
              subtitle={
                <>
                  Add them under <code className="font-mono">mcp</code> in opencode.json, or in{" "}
                  <code className="font-mono">.mcp.json</code> for Claude Code, then reload.
                </>
              }
            />
          ) : (
            entries.map((entry) => <McpRow key={entry.name} entry={entry} actions={actions} />)
          )}
          <PartialFailureRow failed={state.data.failed} />
        </>
      )}
    </PrefsGroup>
  );
}

/**
 * Satu MCP server (AdwActionRow): ikon simbolik berwarna status, nama, lalu
 * status per agent di subjudul — "logo Label" untuk tiap agent pemakai.
 * Error tampil di bawahnya per agent. Tombol "⋯" membuka menu aksi; selama
 * aksi berjalan, label agent itu menjadi "Reconnecting…" dsb.
 */
function McpRow({ entry, actions }: { entry: McpServerEntry; actions: UseMcpActionsResult }) {
  const targets = entry.agents.map((agent) => ({
    agent,
    status: entry.byAgent[agent]?.status ?? ("unknown" as const),
    busy: actions.busy(agent, entry.name),
  }));
  const anyBusy = targets.some((t) => t.busy !== undefined);
  const errors = entry.agents
    .map((a) => ({ agent: a, error: entry.byAgent[a]?.error ?? null }))
    .filter((e): e is { agent: AgentType; error: string } => e.error !== null);
  return (
    <ActionRow
      prefix={<PlugIcon className={cn("size-[18px]", MCP_ICON[entry.status])} aria-hidden />}
      title={<span className="block truncate">{entry.name}</span>}
      subtitle={
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {targets.map(({ agent: a, status, busy }) => {
              const label = busy ? MCP_ACTION_PROGRESS[busy] : mcpAgentLabel(a, status);
              return (
                <span
                  key={a}
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    busy ? "text-muted-foreground" : MCP_TEXT[status],
                  )}
                  title={
                    a === "claude-code" && status === "unknown" && !busy
                      ? "Configured for Claude Code. Status appears once a Claude Code session runs in this project — or use Reconnect to check it now."
                      : `${AGENT_TYPE_LABELS[a]}: ${label}`
                  }
                >
                  {busy ? (
                    <Spinner className="size-3" aria-hidden />
                  ) : (
                    <AgentLogo agentType={a} className="size-3" />
                  )}
                  <span className="sr-only">{AGENT_TYPE_LABELS[a]}:</span>
                  {label}
                </span>
              );
            })}
          </span>
          {errors.map((e) => (
            <span
              key={e.agent}
              className="line-clamp-2 font-mono text-[11.5px] leading-relaxed break-all text-destructive/90"
              title={e.error}
            >
              {entry.agents.length > 1 && `${AGENT_TYPE_LABELS[e.agent]}: `}
              {e.error}
            </span>
          ))}
        </span>
      }
      suffix={
        <McpServerMenu
          name={entry.name}
          targets={targets}
          onAction={(agent, action) => void actions.run(agent, entry.name, action)}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${entry.name}`}
            title="Reconnect, enable, or disable"
            className="size-8 rounded-full text-muted-foreground"
          >
            {anyBusy ? <Spinner /> : <MoreHorizontalIcon />}
          </Button>
        </McpServerMenu>
      }
    />
  );
}
