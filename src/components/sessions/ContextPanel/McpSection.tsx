import { ChevronDownIcon, MoreHorizontalIcon, PlugIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { McpServerMenu } from "@/components/sessions/McpServerMenu";
import { Spinner } from "@/components/ui/spinner";
import type { UseMcpActionsResult } from "@/hooks/useMcpActions";
import {
  MCP_ACTION_PROGRESS,
  MCP_STATUS_DOT,
  MCP_STATUS_LABEL,
  type McpAction,
} from "@/lib/project-extensions";
import { cn } from "@/lib/utils";
import type { AgentType, McpServerState } from "@/types";
import { Box, Empty, ROW, RowContent, Section } from "./primitives";

/** Aksi MCP (`useMcpActions`) untuk agent Session. */
export type McpPanelActions = UseMcpActionsResult & { agent: AgentType };

/** Status yang "perlu login" — dilipat jadi satu baris bila lebih dari satu. */
const NEEDS_SIGN_IN: McpServerState["status"][] = ["needs_auth", "needs_client_registration"];

export function McpSection({
  servers,
  live,
  actions,
}: {
  servers: McpServerState[];
  live: boolean;
  actions?: McpPanelActions;
}) {
  const connected = servers.filter((s) => s.status === "connected").length;
  const failed = servers.filter((s) => s.status === "failed").length;
  const byName = (a: McpServerState, b: McpServerState) => a.name.localeCompare(b.name);
  const signIn = servers.filter((s) => NEEDS_SIGN_IN.includes(s.status)).sort(byName);
  const inactive = servers
    .filter((s) => s.status === "disabled" || s.status === "unknown")
    .sort(byName);
  // Baris individual: gagal (paling atas), sedang menyambung, lalu
  // tersambung. Kelompok berisi satu server tetap tampil sebagai baris biasa
  // (tidak perlu dilipat).
  const individual = [
    ...servers.filter((s) => s.status === "failed").sort(byName),
    ...servers.filter((s) => s.status === "pending").sort(byName),
    ...servers.filter((s) => s.status === "connected").sort(byName),
    ...(signIn.length === 1 ? signIn : []),
    ...(inactive.length === 1 ? inactive : []),
  ];

  return (
    <Section
      title="MCP"
      summary={
        servers.length > 0 ? (
          // Hanya kegagalan yang diberi warna peringatan — konektor yang
          // belum login itu normal, bukan masalah.
          <span className={cn(failed > 0 && "text-amber-700 dark:text-amber-400")}>
            {connected}/{servers.length} connected
          </span>
        ) : undefined
      }
    >
      {servers.length === 0 ? (
        <Empty>{live ? "No MCP servers configured" : "Start the session to see MCP servers"}</Empty>
      ) : (
        <Box>
          {individual.map((server) => (
            <McpRow key={server.name} server={server} actions={actions} />
          ))}
          {signIn.length > 1 && (
            <McpGroupRow
              label={`${signIn.length} need sign-in`}
              dotClass={MCP_STATUS_DOT.needs_auth}
              servers={signIn}
              actions={actions}
            />
          )}
          {inactive.length > 1 && (
            <McpGroupRow
              label={`${inactive.length} inactive`}
              dotClass={MCP_STATUS_DOT.disabled}
              servers={inactive}
              actions={actions}
            />
          )}
        </Box>
      )}
    </Section>
  );
}

/** Gaya pemicu menu aksi MCP (baris / item kelompok). */
const MCP_TRIGGER =
  "w-full text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 data-[state=open]:bg-muted/50";

/** Pembungkus menu aksi satu server (agent Session). */
function McpMenu({
  server,
  actions,
  busy,
  children,
}: {
  server: McpServerState;
  actions: McpPanelActions;
  busy: McpAction | undefined;
  children: ReactNode;
}) {
  return (
    <McpServerMenu
      name={server.name}
      targets={[{ agent: actions.agent, status: server.status, busy }]}
      onAction={(agent, action) => void actions.run(agent, server.name, action)}
    >
      {children}
    </McpServerMenu>
  );
}

/**
 * Satu server MCP: nama + status (titik + label); error di baris kedua.
 * Dengan `actions`, seluruh baris membuka menu aksi server.
 */
function McpRow({ server, actions }: { server: McpServerState; actions?: McpPanelActions }) {
  const busy = actions?.busy(actions.agent, server.name);
  const content = (
    <RowContent
      icon={<PlugIcon />}
      label={server.name}
      hint={server.error ?? undefined}
      hintTone={server.error ? "error" : undefined}
      value={<StatusText status={server.status} busy={busy} />}
    />
  );
  // Pesan error lengkap terbaca lewat `title` (baris kedua terpotong).
  const title = server.error ?? undefined;
  if (!actions) {
    return (
      <li title={title} className={ROW}>
        {content}
      </li>
    );
  }
  return (
    <li>
      <McpMenu server={server} actions={actions} busy={busy}>
        <button type="button" title={title} className={cn(ROW, MCP_TRIGGER)}>
          {content}
          <MoreHorizontalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </McpMenu>
    </li>
  );
}

function StatusText({
  status,
  busy,
}: {
  status: McpServerState["status"];
  /** Aksi berjalan -> spinner + "Reconnecting…" menggantikan status. */
  busy?: McpAction;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      {busy ? (
        <Spinner className="size-3" aria-hidden />
      ) : (
        <span aria-hidden className={cn("size-1.5 rounded-full", MCP_STATUS_DOT[status])} />
      )}
      {busy ? MCP_ACTION_PROGRESS[busy] : MCP_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Baris kelompok yang bisa dibuka (AdwExpanderRow): "17 need sign-in" —
 * isinya nama server, tanpa status berulang (sudah di judul baris).
 */
function McpGroupRow({
  label,
  dotClass,
  servers,
  actions,
}: {
  label: string;
  dotClass: string;
  servers: McpServerState[];
  actions?: McpPanelActions;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-9 w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
          <span className={cn("size-1.5 rounded-full", dotClass)} />
        </span>
        <span className="min-w-0 flex-1 truncate leading-5 text-muted-foreground">{label}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul className="border-t bg-muted/30 py-1">
          {servers.map((s) => (
            <McpGroupItem key={s.name} server={s} actions={actions} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Satu server di kelompok yang dibuka: nama saja (status sudah di judul). */
function McpGroupItem({ server, actions }: { server: McpServerState; actions?: McpPanelActions }) {
  const busy = actions?.busy(actions.agent, server.name);
  const item = "px-2.5 py-1 ps-8 text-[12px] leading-5 text-muted-foreground";
  if (!actions) {
    return (
      <li title={server.error ?? server.name} className={cn("truncate", item)}>
        {server.name}
      </li>
    );
  }
  return (
    <li>
      <McpMenu server={server} actions={actions} busy={busy}>
        <button
          type="button"
          title={server.error ?? server.name}
          className={cn("flex items-center gap-2", item, MCP_TRIGGER)}
        >
          <span className="min-w-0 flex-1 truncate">{server.name}</span>
          {busy ? (
            <Spinner className="size-3" aria-hidden />
          ) : (
            <MoreHorizontalIcon aria-hidden className="size-3.5 shrink-0" />
          )}
        </button>
      </McpMenu>
    </li>
  );
}
