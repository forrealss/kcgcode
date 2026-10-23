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
import { ConfirmSessionDeleteDialog } from "@/components/sessions/ConfirmSessionDeleteDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { type SessionLifecycleAction, useSessionLifecycle } from "@/hooks/useSessionLifecycle";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";

export interface SidebarSessionMenuProps {
  session: Session;
  /** Judul tampilan (untuk label aksesibel). */
  title: string;
  /** Dipanggil setelah Session berhasil dihapus. */
  onDeleted?: () => void;
}

export function SidebarSessionMenu({ session, title, onDeleted }: SidebarSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lifecycle = useSessionLifecycle({
    onSuccess: (action) => {
      if (action === "delete") setConfirmDelete(false);
    },
  });
  const { busy: busyIds } = lifecycle;
  const busy = busyIds.stop !== null || busyIds.start !== null || busyIds.restart !== null;
  const deleting = busyIds.delete !== null;
  const running = session.status === "running";

  const run = (action: SessionLifecycleAction) => void lifecycle.run(action, session.id);

  const remove = async () => {
    if (await lifecycle.run("delete", session.id)) onDeleted?.();
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Session actions: ${title}`}
            disabled={busy}
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
              busy && "opacity-100",
              "[&>svg]:size-4",
            )}
          >
            {busy ? <Spinner className="size-3.5" /> : <MoreVerticalIcon />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="min-w-40">
          {running ? (
            <>
              <DropdownMenuItem onSelect={() => run("stop")}>
                <SquareIcon />
                Stop
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run("restart")}>
                <RotateCcwIcon />
                Restart
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => run("start")}>
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
