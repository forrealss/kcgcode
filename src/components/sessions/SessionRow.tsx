/**
 * Satu baris Session di daftar (`SessionList`) — baris boxed list ala
 * AdwActionRow (libadwaita), sama dengan baris panel samping Project: logo
 * agent 18px sebagai ikon, judul + subjudul (status berwarna · model ·
 * waktu), tombol menu bundar sebagai suffix, lalu chevron navigasi.
 * Badan baris adalah tombol buka (target sentuh lebar); aksi sekunder ada di
 * menu "..." — di perangkat dengan pointer halus (mouse) menu baru muncul
 * saat hover/fokus agar daftar tetap bersih, di layar sentuh selalu tampil.
 * Pemanggil membungkusnya dengan `<li>` di dalam `PrefsGroup`.
 */
import {
  CheckIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
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
import { AGENT_TYPE_LABELS } from "@/lib/agent-types";
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
  /**
   * Selection mode (hapus massal): kotak centang di depan, klik baris
   * memilih/membatalkan pilihan, menu & chevron disembunyikan.
   */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

/** Kotak centang ala GtkCheckButton (GTK4): kotak membulat, terisi aksen. */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/45",
      )}
    >
      {checked && <CheckIcon className="size-3" strokeWidth={3.5} />}
    </span>
  );
}

/** Warna teks status di subjudul (selaras status MCP di panel samping). */
const STATUS_TEXT: Record<Session["status"], string> = {
  running: "text-emerald-700 dark:text-emerald-400",
  crashed: "text-destructive",
  stopped: "text-muted-foreground",
};

/**
 * Status di awal subjudul — titik + label berwarna, seperti status MCP.
 * `stopped` (keadaan biasa) tidak ditampilkan agar daftar tidak ramai.
 */
function StatusLabel({ session, busy }: { session: Session; busy: boolean }) {
  if (busy) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <Spinner className="size-3" />
        Working…
      </span>
    );
  }
  if (session.status === "stopped") return null;
  const running = session.status === "running";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", STATUS_TEXT[session.status])}>
      <span className="relative flex size-1.5" aria-hidden>
        {running && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-1.5 rounded-full",
            SESSION_STATUS_DOT[session.status],
          )}
        />
      </span>
      {SESSION_STATUS_LABEL[session.status]}
    </span>
  );
}

/** Pemisah "·" di subjudul; jarak kiri/kanan datang dari `gap` induk. */
function Dot() {
  return (
    <span className="opacity-50" aria-hidden>
      ·
    </span>
  );
}

export function SessionRow({
  session,
  busy,
  onOpen,
  onStop,
  onStart,
  onDelete,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: SessionRowProps) {
  const running = session.status === "running";
  const title = displaySessionTitle(session.title);
  const agentLabel = AGENT_TYPE_LABELS[session.agentType];
  const hasStatus = busy || session.status !== "stopped";

  return (
    // Baris AdwActionRow yang bisa diaktifkan — sama dengan baris di panel
    // samping: ikon simbolik 18px, judul 15px + subjudul 13px, suffix, lalu
    // chevron. Tombol buka "direntangkan" (after:inset-0) sehingga seluruh
    // baris, termasuk chevron, bisa diklik; tombol menu berada di atasnya.
    <div
      className={cn(
        "group relative flex min-h-14 items-center gap-3 pr-4 pl-4 transition-colors hover:bg-muted/60 has-focus-visible:bg-muted/60 has-[button:active]:bg-muted",
        selectionMode && selected && "bg-primary/[0.06]",
      )}
    >
      {selectionMode && <CheckBox checked={selected} />}
      <AgentLogo agentType={session.agentType} className="size-[18px] text-muted-foreground" />
      <button
        type="button"
        onClick={selectionMode ? onToggleSelect : onOpen}
        disabled={busy}
        aria-pressed={selectionMode ? selected : undefined}
        title={`${title} — ${agentLabel}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40 focus-visible:after:ring-inset disabled:opacity-60"
        aria-label={`${selectionMode ? "Select" : "Open"} session ${title}, ${agentLabel}, ${SESSION_STATUS_LABEL[session.status]}`}
      >
        <span className="truncate text-[15px] leading-5">{title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-muted-foreground">
          <StatusLabel session={session} busy={busy} />
          {/* Layar sempit + ada status: model disembunyikan (terpotong jadi
              tak terbaca); status & waktu lebih penting. */}
          <span className={cn("contents", hasStatus && "max-sm:hidden")}>
            {hasStatus && <Dot />}
            <span className="truncate">{describeSessionModel(session)}</span>
          </span>
          <Dot />
          <span className="shrink-0 tabular-nums">{formatRelativeTime(session.updatedAt)}</span>
        </span>
      </button>

      {!selectionMode && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Suffix: tombol bundar datar. Mouse: muncul saat hover/fokus;
                  layar sentuh: selalu tampil. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`Session actions ${title}`}
                className="relative z-10 shrink-0 rounded-full text-muted-foreground transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </>
      )}
    </div>
  );
}

/** Placeholder daftar Session saat memuat — bentuk boxed list yang sama. */
export function SessionListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden>
      <div className="flex flex-col gap-1.5 px-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
            <Skeleton className="size-[18px] shrink-0 rounded" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4" style={{ width: `${55 - i * 10}%` }} />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
