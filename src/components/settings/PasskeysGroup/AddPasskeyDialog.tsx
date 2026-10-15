/**
 * Dialog tambah passkey: konfirmasi PIN/password saat ini dulu, lalu dialog
 * sistem browser (sidik jari, wajah, atau kunci layar perangkat).
 */
import { FingerprintIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { SecretInput } from "@/components/auth/SecretInput";
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
import { lockLabel } from "@/lib/auth";
import { addPasskey, type PasskeyInfo } from "@/lib/passkeys";
import type { AuthStatus } from "@/server/services/auth";

export function AddPasskeyDialog({
  open,
  status,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  status: AuthStatus;
  onOpenChange: (open: boolean) => void;
  onAdded: (p: PasskeyInfo) => void;
}) {
  const kind = status.lockKind ?? "password";
  const label = lockLabel(kind);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (current === "") return;
    setBusy(true);
    setError(null);
    const res = await addPasskey(current);
    setBusy(false);
    if (res.ok) {
      onAdded(res.data);
      return;
    }
    // Batal di dialog sistem: kembali ke dialog ini tanpa pesan merah.
    if (res.cancelled) return;
    setError(res.message);
    if (res.code === "CURRENT_SECRET_INVALID") {
      setCurrent("");
      inputRef.current?.focus();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <span className="mb-1 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FingerprintIcon className="size-7" aria-hidden />
          </span>
          <DialogTitle>Add a passkey</DialogTitle>
          <DialogDescription>
            Confirm your {label} first. Then your device will ask for your fingerprint, face, or
            screen lock.
          </DialogDescription>
        </DialogHeader>

        <form id="add-passkey-form" onSubmit={submit} className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-col px-4 py-2 focus-within:bg-muted/30">
              <label htmlFor={inputId} className="text-[12px] leading-4 text-muted-foreground">
                Current {label}
              </label>
              <SecretInput
                ref={inputRef}
                id={inputId}
                kind={kind}
                autoComplete="current-password"
                value={current}
                disabled={busy}
                onChange={(v) => {
                  setCurrent(v);
                  setError(null);
                }}
                className="h-7"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="px-1 text-sm text-destructive">
              {error}
            </p>
          )}
          <p className="px-1 text-[12px] leading-snug text-muted-foreground">
            The passkey works on this address only. Your fingerprint or face never leaves your
            device.
          </p>
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-passkey-form" disabled={busy || current === ""}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FingerprintIcon data-icon="inline-start" />
            )}
            {busy ? "Waiting for your device…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
