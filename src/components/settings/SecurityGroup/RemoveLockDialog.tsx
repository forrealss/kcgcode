/** Dialog hapus kunci aplikasi (konfirmasi dengan kunci saat ini). */
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
import { apiFetch, errorText } from "@/lib/api";
import { lockLabel, refreshAuth } from "@/lib/auth";
import type { AuthStatus } from "@/server/services/auth";
import { SecretField } from "./SecretField";

export function RemoveLockDialog({
  open,
  status,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  status: AuthStatus;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = status.lockKind ?? "password";

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setError(null);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/lock", { method: "DELETE", body: JSON.stringify({ current }) });
      await refreshAuth();
      onDone();
    } catch (err) {
      setError(errorText(err, "Couldn't remove the lock."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove app lock?</DialogTitle>
          <DialogDescription>
            Without a lock, anyone who can reach this address can control your agents. All devices
            will be signed out and every passkey will be removed.
          </DialogDescription>
        </DialogHeader>
        <form id="remove-lock-form" onSubmit={submit} className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="flex flex-col divide-y">
              <SecretField
                label={`Current ${lockLabel(kind)}`}
                kind={kind}
                value={current}
                onChange={(v) => {
                  setCurrent(v);
                  setError(null);
                }}
                autoComplete="current-password"
                autoFocus
              />
            </ul>
          </div>
          {error && (
            <p role="alert" className="px-1 text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="remove-lock-form"
            variant="destructive"
            disabled={busy || current === ""}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
