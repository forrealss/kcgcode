/** Dialog konfirmasi hapus passkey. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/api";
import { type PasskeyInfo, removePasskey } from "@/lib/passkeys";

export function RemovePasskeyDialog({
  passkey,
  onOpenChange,
  onRemoved,
}: {
  passkey: PasskeyInfo | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: (p: PasskeyInfo) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (passkey) setError(null);
  }, [passkey]);

  const remove = async () => {
    if (!passkey) return;
    setBusy(true);
    setError(null);
    try {
      await removePasskey(passkey.id);
      onRemoved(passkey);
    } catch (e) {
      setError(errorText(e, "Couldn't remove the passkey."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={passkey !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {passkey?.name}?</DialogTitle>
          <DialogDescription>
            You won't be able to unlock with it anymore. It may still appear in your device's
            password manager; you can delete it there too.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
