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

export type ConfirmKind = "stop" | "rotate" | "signout";

const CONFIRM_COPY: Record<
  ConfirmKind,
  { title: string; body: string; action: string; destructive: boolean }
> = {
  stop: {
    title: "Turn off remote access?",
    body: "Your link will stop working and any phone or computer using it will be disconnected. You can turn it back on from this computer anytime.",
    action: "Turn off",
    destructive: true,
  },
  rotate: {
    title: "Reset security key?",
    body: "Remote access restarts, so your link stops for a few seconds. Other computers linked to your account will need to sign in again.",
    action: "Reset",
    destructive: false,
  },
  signout: {
    title: "Unlink this computer?",
    body: "Remote access turns off and this computer is removed from your Google account. You can set it up again anytime.",
    action: "Unlink",
    destructive: true,
  },
};

/** Konfirmasi aksi yang sulit dibatalkan dari jarak jauh (mis. dari HP). */
export function ConfirmDialog({
  kind,
  viaTunnel,
  busy,
  onOpenChange,
  onConfirm,
}: {
  kind: ConfirmKind | null;
  viaTunnel: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (kind: ConfirmKind) => void;
}) {
  // Simpan salinan terakhir agar teks tidak hilang saat animasi tutup.
  const [last, setLast] = useState<ConfirmKind>("stop");
  if (kind && kind !== last) setLast(kind);
  const copy = CONFIRM_COPY[kind ?? last];
  const cutsSession = viaTunnel && (kind ?? last) !== "rotate";

  return (
    <AlertDialog open={kind !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.body}
            {cutsSession && (
              <>
                {" "}
                <strong className="font-medium text-foreground">
                  You're using this link right now, so this page will close its connection.
                </strong>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={copy.destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(kind ?? last);
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
