/**
 * Dialog pasang / ganti kunci aplikasi: kunci saat ini (bila sudah dikunci),
 * pilihan PIN/password, lalu kunci baru + konfirmasinya.
 */
import { useEffect, useState } from "react";
import { LockKindPicker } from "@/components/auth/LockKindPicker";
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
import { type LockKind, validateNewLock } from "@/lib/lock-secret";
import type { AuthStatus } from "@/server/services/auth";
import { SecretField } from "./SecretField";

export function LockDialog({
  open,
  status,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  status: AuthStatus;
  onOpenChange: (open: boolean) => void;
  onDone: (kind: LockKind) => void;
}) {
  const [kind, setKind] = useState<LockKind>(status.lockKind ?? "pin");
  const [current, setCurrent] = useState("");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentKind = status.lockKind ?? "password";

  // Reset setiap kali dibuka.
  useEffect(() => {
    if (!open) return;
    setKind(status.lockKind ?? "pin");
    setCurrent("");
    setSecret("");
    setConfirm("");
    setError(null);
  }, [open, status.lockKind]);

  const hint =
    kind === "pin"
      ? "6–12 digits. Avoid repeated or sequential digits like 111111 or 123456."
      : "At least 8 characters. A short phrase is easy to remember and hard to guess.";

  const localError = (): string | null => {
    if (status.protected && current === "") return `Enter your current ${lockLabel(currentKind)}.`;
    return validateNewLock(kind, secret, confirm);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local = localError();
    if (local) {
      setError(local);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/lock", {
        method: "PUT",
        body: JSON.stringify({ kind, secret, current: status.protected ? current : undefined }),
      });
      await refreshAuth();
      onDone(kind);
    } catch (err) {
      setError(errorText(err, "Couldn't save the lock."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{status.protected ? "Change lock" : "Set up app lock"}</DialogTitle>
          <DialogDescription>
            {status.protected
              ? "Other devices will be signed out and must unlock again."
              : "You'll need it to open KCG Code on any device."}
          </DialogDescription>
        </DialogHeader>

        <form id="lock-form" onSubmit={submit} className="flex flex-col gap-5">
          {status.protected && (
            <div className="overflow-hidden rounded-xl border bg-card">
              <ul className="flex flex-col divide-y">
                <SecretField
                  label={`Current ${lockLabel(currentKind)}`}
                  kind={currentKind}
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
          )}

          {/* Pemilih jenis kunci: segmented control ala GNOME */}
          <div className="flex flex-col gap-2">
            <span id="lock-kind-label" className="px-1 text-[13px] font-medium">
              Lock type
            </span>
            <LockKindPicker
              name="lock-kind"
              aria-labelledby="lock-kind-label"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setSecret("");
                setConfirm("");
                setError(null);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-xl border bg-card">
              <ul className="flex flex-col divide-y">
                <SecretField
                  label={`New ${lockLabel(kind)}`}
                  kind={kind}
                  value={secret}
                  onChange={(v) => {
                    setSecret(v);
                    setError(null);
                  }}
                  autoComplete="new-password"
                  autoFocus={!status.protected}
                  hint={hint}
                />
                <SecretField
                  label={`Confirm ${lockLabel(kind)}`}
                  kind={kind}
                  value={confirm}
                  onChange={(v) => {
                    setConfirm(v);
                    setError(null);
                  }}
                  autoComplete="new-password"
                />
              </ul>
            </div>
            <p className="px-1 text-[12px] text-muted-foreground">{hint}</p>
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
          <Button type="submit" form="lock-form" disabled={busy || secret === "" || confirm === ""}>
            {busy && <Spinner data-icon="inline-start" />}
            {status.protected ? "Change" : "Turn on"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
