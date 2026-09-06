/**
 * Konfirmasi hapus Session permanen (dipakai header chat `SessionView` dan
 * menu baris `SessionList`). Menghapus juga riwayat percakapan di server
 * opencode — tidak bisa dibatalkan.
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

export interface ConfirmSessionDeleteDialogProps {
  open: boolean;
  /** Tutup dialog (ditolak bila aksi sedang berjalan). */
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  /** Jalankan penghapusan (engine). */
  onConfirm: () => void;
}

export function ConfirmSessionDeleteDialog({
  open,
  onOpenChange,
  deleting,
  onConfirm,
}: ConfirmSessionDeleteDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this session?</AlertDialogTitle>
          <AlertDialogDescription>
            The conversation history on the opencode server will also be permanently deleted. This
            action cannot be undone.
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
              "Delete permanently"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
