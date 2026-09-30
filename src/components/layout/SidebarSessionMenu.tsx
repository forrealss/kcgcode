/**
 * Menu "..." per baris Session di sidebar — KHUSUS desktop.
 *
 * - Titik tiga vertikal di celah kosong kanan baris (di luar area hover
 *   baris). Muncul saat baris di-hover / difokus keyboard (`group-hover`),
 *   tetap terlihat selama menu terbuka.
 * - Aksi sesuai status: running -> Stop & Restart; stopped/crashed -> Start.
 *   Delete selalu ada (dengan dialog konfirmasi).
 * - Setelah aksi, sidebar & daftar lain terbarui otomatis lewat broadcast
 *   server (`session_status`, `session_deleted`, `data_changed`) — di sini
 *   tidak perlu memuat ulang manual.
 */
import { MoreVerticalIcon, PlayIcon, RotateCcwIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmSessionDeleteDialog } from "@/components/sessions/ConfirmSessionDeleteDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { notifyDataChanged } from "@/lib/data-events";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";

type Busy = "stop" | "start" | "restart" | null;

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export interface SidebarSessionMenuProps {
  session: Session;
  /** Judul tampilan (untuk label aksesibel). */
  title: string;
  /** Dipanggil setelah Session berhasil dihapus. */
  onDeleted?: () => void;
}

export function SidebarSessionMenu({ session, title, onDeleted }: SidebarSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const running = session.status === "running";

  const stop = () => apiFetch(`/api/sessions/${session.id}/stop`, { method: "POST" });
  const start = () => apiFetch(`/api/sessions/${session.id}`, { method: "POST" });

  const run = async (kind: Exclude<Busy, null>) => {
    setBusy(kind);
    try {
      if (kind === "stop") {
        await stop();
        toast.success("Session stopped.");
      } else if (kind === "start") {
        await start();
        toast.success("Session started.");
      } else {
        await stop();
        await start();
        toast.success("Session restarted.");
      }
      notifyDataChanged();
    } catch (e) {
      toast.error(
        errorText(
          e,
          kind === "stop"
            ? "Couldn't stop the session."
            : kind === "start"
              ? "Couldn't start the session."
              : "Couldn't restart the session.",
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      toast.success("Session deleted.");
      notifyDataChanged();
      onDeleted?.();
    } catch (e) {
      toast.error(errorText(e, "Couldn't delete the session."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Session actions: ${title}`}
            disabled={busy !== null}
            className={cn(
              // Diselipkan di celah kosong KANAN baris (margin kanan
              // `SidebarMenuSub` = 24px), bukan menimpa judul: lebar 24px
              // menempel tepat di tepi baris agar hover tidak "putus" saat
              // kursor bergeser dari baris ke tombol.
              "absolute top-1/2 -right-6 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/60 outline-hidden transition-opacity",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              // Tersembunyi sampai baris di-hover / difokus; tetap terlihat
              // selama menu terbuka atau aksi berjalan.
              "opacity-0 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 data-[state=open]:opacity-100",
              busy !== null && "opacity-100",
              "[&>svg]:size-4",
            )}
          >
            {busy !== null ? <Spinner className="size-3.5" /> : <MoreVerticalIcon />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="min-w-40">
          {running ? (
            <>
              <DropdownMenuItem onSelect={() => void run("stop")}>
                <SquareIcon />
                Stop
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void run("restart")}>
                <RotateCcwIcon />
                Restart
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => void run("start")}>
              <PlayIcon />
              {session.status === "crashed" ? "Restart" : "Start"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            // Tunda buka dialog sampai menu selesai menutup (fokus aman).
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmSessionDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        deleting={deleting}
        onConfirm={() => void remove()}
      />
    </>
  );
}
