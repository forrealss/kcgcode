/**
 * Konfirmasi hapus Project (beserta seluruh Session-nya) dari halaman daftar
 * Session. Server membersihkan Session terlebih dahulu; direktori kerja di
 * filesystem tidak disentuh.
 */

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

export interface ConfirmDeleteProjectDialogProps {
  open: boolean;
  /** Tutup dialog (ditolak bila aksi sedang berjalan). */
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /** Jumlah Session milik project — disertakan ke teks peringatan. */
  sessionTotal: number;
  deleting: boolean;
  /** Jalankan penghapusan Project. */
  onConfirm: () => void;
}

export function ConfirmDeleteProjectDialog({
  open,
  onOpenChange,
  projectName,
  sessionTotal,
  deleting,
  onConfirm,
}: ConfirmDeleteProjectDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project “{projectName}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {sessionTotal > 0
              ? `${sessionTotal} session${sessionTotal === 1 ? "" : "s"} of this project will also be permanently deleted, including their conversation history on the opencode server. `
              : ""}
            The working folder on the server is not deleted — only the project registration in KCG
            Code. This action cannot be undone.
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
                Deleting…
              </>
            ) : (
              "Delete project"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
