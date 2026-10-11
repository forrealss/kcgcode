/**
 * Konfirmasi hapus Session permanen (dipakai header chat `SessionView`, menu
 * baris `SessionList`, dan hapus massal selection mode). Menghapus juga
 * riwayat percakapan di agent (opencode / Claude Code) — tidak bisa
 * dibatalkan. `count` > 1 = hapus massal; `progress` menampilkan kemajuan.
 */

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { pluralSessions } from "@/lib/session-selection";

export interface ConfirmSessionDeleteDialogProps {
  open: boolean;
  /** Tutup dialog (ditolak bila aksi sedang berjalan). */
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  /** Jalankan penghapusan (engine). */
  onConfirm: () => void;
  /** Jumlah Session yang dihapus (default 1). */
  count?: number;
  /** Kemajuan hapus massal. */
  progress?: { done: number; total: number } | null;
}

export function ConfirmSessionDeleteDialog({
  open,
  onOpenChange,
  deleting,
  onConfirm,
  count = 1,
  progress = null,
}: ConfirmSessionDeleteDialogProps) {
  // Jumlah dibekukan selama animasi tutup: setelah hapus massal pilihan
  // sudah kosong, tapi teks dialog yang memudar tidak boleh berganti.
  const [shownCount, setShownCount] = useState(count);
  if (open && count !== shownCount) setShownCount(count);
  const many = shownCount > 1;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {many ? `Delete ${pluralSessions(shownCount)}?` : "Delete this session?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {many ? "Their conversation histories" : "The conversation history"} will also be
            permanently deleted from the agent. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={deleting}
          >
            {deleting ? (
              <>
                <Spinner data-icon="inline-start" />
                {progress && progress.total > 1
                  ? `Deleting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : "Deleting…"}
              </>
            ) : many ? (
              `Delete ${pluralSessions(shownCount)}`
            ) : (
              "Delete permanently"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
