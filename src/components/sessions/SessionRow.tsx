/**
 * Satu baris Session di daftar (`SessionList`).
 *
 * Baris polos tanpa kotak: titik status, judul, meta tipis, waktu di kanan.
 * Badan baris adalah tombol buka (target sentuh lebar); aksi sekunder ada di
 * menu "..." — di perangkat dengan pointer halus (mouse) menu baru muncul
 * saat hover/fokus agar daftar tetap bersih, di layar sentuh selalu tampil.
 */
import { MoreHorizontalIcon, PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";
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
import { displaySessionTitle } from "@/lib/session-title";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";

export interface SessionRowProps {
  session: Session;
  /** Ada aksi berjalan untuk Session ini — kunci baris agar tidak dobel klik. */
  busy: boolean;
  onOpen: () => void;
  onStop: () => void;
  onStart: () => void;
  onDelete: () => void;
}

/** Titik status; running diberi denyut halus. */
function StatusDot({ session, busy }: { session: Session; busy: boolean }) {
  if (busy) return <Spinner className="size-3 text-muted-foreground" />;
  const running = session.status === "running";
  return (
    <span className="relative flex size-2" aria-hidden>
      {running && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-50" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          SESSION_STATUS_DOT[session.status],
        )}
      />
    </span>
  );
}

export function SessionRow({ session, busy, onOpen, onStop, onStart, onDelete }: SessionRowProps) {
  const running = session.status === "running";
  const title = displaySessionTitle(session.title);

  return (
    <div className="group relative flex items-center rounded-lg transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="flex min-w-0 flex-1 items-center gap-3.5 rounded-lg px-3 py-3 text-left focus-visible:outline-none disabled:opacity-60"
        aria-label={`Open session ${title}, ${SESSION_STATUS_LABEL[session.status]}`}
      >
        <span className="flex size-3 shrink-0 items-center justify-center">
          <StatusDot session={session} busy={busy} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-medium leading-snug">{title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {session.agentType}
            <span className="mx-1.5 opacity-50">/</span>
            {describeSessionModel(session)}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`Session actions ${title}`}
            className="mr-1.5 shrink-0 rounded-full text-muted-foreground transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon />
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
    <div className="flex flex-col" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3.5 py-3">
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
