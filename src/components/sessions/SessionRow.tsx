/**
 * Satu baris Session di daftar (`SessionList`).
 *
 * Badan baris adalah tombol buka (target sentuh lebar), aksi sekunder
 * dikumpulkan di menu "..." — di layar HP deretan tombol ikon kecil sulit
 * ditekan dan mudah salah sentuh.
 */
import {
  BotIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/project-overview";
import { SESSION_STATUS_DOT, SESSION_STATUS_LABEL } from "@/lib/session-status";
import { describeSessionModel } from "@/lib/session-summary";
import { cn } from "@/lib/utils";
import type { Session, SessionStatus } from "@/types";

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", SESSION_STATUS_DOT[status])} />
      {SESSION_STATUS_LABEL[status]}
    </Badge>
  );
}

export interface SessionRowProps {
  session: Session;
  /** Ada aksi berjalan untuk Session ini — kunci baris agar tidak dobel klik. */
  busy: boolean;
  onOpen: () => void;
  onStop: () => void;
  onStart: () => void;
  onDelete: () => void;
}

export function SessionRow({ session, busy, onOpen, onStop, onStart, onDelete }: SessionRowProps) {
  const running = session.status === "running";

  return (
    <div className="group flex items-center gap-1 rounded-xl border bg-card pr-1 shadow-sm transition-all focus-within:border-primary/40 hover:border-primary/40 hover:shadow-md">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 sm:px-4"
        aria-label={`Open session ${session.agentType}`}
      >
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {busy ? <Spinner className="size-4" /> : <BotIcon />}
          {running && !busy && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
              aria-hidden
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{session.agentType}</span>
            <StatusBadge status={session.status} />
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {describeSessionModel(session)} · {formatRelativeTime(session.updatedAt)}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Session actions ${session.agentType}`}
            className="shrink-0"
          >
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {running ? (
            <DropdownMenuItem onSelect={onStop}>
              <SquareIcon />
              Stop
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onStart}>
              <PlayIcon />
              Start
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Placeholder daftar Session saat memuat — menjaga tinggi konten. */
export function SessionListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="size-8 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}
