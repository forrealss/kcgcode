/**
 * Settings -> Security (`/settings/security`): kunci aplikasi (PIN/password),
 * ganti/hapus kunci lewat dialog, kunci otomatis, dan passkey.
 */
import {
  KeyRoundIcon,
  LockIcon,
  LockOpenIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TimerIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PasskeysGroup } from "@/components/settings/PasskeysGroup";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { lockLabel, refreshAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";

type LockKind = "pin" | "password";

const AUTO_LOCK_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
];

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function SecurityGroup({ status, onOk }: { status: AuthStatus; onOk: (t: string) => void }) {
  const [dialog, setDialog] = useState<"set" | "remove" | null>(null);
  const [autoLock, setAutoLock] = useState(status.autoLockMinutes);
  const [autoLockError, setAutoLockError] = useState<string | null>(null);
  const autoLockId = useId();

  const saveAutoLock = async (minutes: number) => {
    const prev = autoLock;
    setAutoLock(minutes);
    setAutoLockError(null);
    try {
      await apiFetch("/api/auth/settings", {
        method: "PATCH",
        body: JSON.stringify({ autoLockMinutes: minutes }),
      });
      toast.success(
        minutes === 0
          ? "Auto-lock turned off."
          : `Auto-lock set to ${AUTO_LOCK_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes} minutes`}.`,
      );
      void refreshAuth();
    } catch (err) {
      setAutoLock(prev);
      setAutoLockError(errorText(err, "Couldn't save auto-lock."));
    }
  };

  const kind = status.lockKind ?? "password";
  const label = lockLabel(kind);

  return (
    <>
      {/* Kartu status: satu pesan jelas + satu aksi utama. Tata letak
          vertikal & terpusat agar tidak sempit di layar HP. */}
      <section
        aria-labelledby="security-status"
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border px-5 py-6 text-center",
          status.protected ? "bg-card shadow-xs" : "border-amber-500/30 bg-amber-500/10",
        )}
      >
        <span
          className={cn(
            "flex size-14 items-center justify-center rounded-full",
            status.protected
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
          )}
        >
          {status.protected ? (
            <ShieldCheckIcon className="size-7" aria-hidden />
          ) : (
            <ShieldAlertIcon className="size-7" aria-hidden />
          )}
        </span>
        <div className="flex max-w-sm flex-col gap-1">
          <h2 id="security-status" className="text-[17px] font-semibold tracking-tight">
            {status.protected ? "KCG Code is locked" : "KCG Code isn't locked"}
          </h2>
          <p className="text-[13px] leading-snug text-muted-foreground">
            {status.protected
              ? `Every phone or computer needs your ${label} before it can open KCG Code.`
              : "Anyone who can open this page can control your agents. Add a PIN or password to keep it safe."}
          </p>
        </div>
        {!status.protected && (
          <Button type="button" className="mt-1" onClick={() => setDialog("set")}>
            <LockIcon data-icon="inline-start" />
            Set up lock
          </Button>
        )}
      </section>

      {status.protected && (
        <>
          <PrefsGroup title="Lock settings">
            <ActionRow
              prefix={<RowGlyph icon={<KeyRoundIcon className="size-[18px]" aria-hidden />} />}
              title={`Change ${label}`}
              subtitle="Other devices will need to unlock again"
              onActivate={() => setDialog("set")}
            />
            {/* Label + select ditumpuk di HP, sebaris di layar lebar. */}
            <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <RowGlyph icon={<TimerIcon className="size-[18px]" aria-hidden />} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label htmlFor={autoLockId} className="text-[15px] leading-5">
                    Lock automatically
                  </label>
                  <span
                    className={cn(
                      "text-[13px] leading-snug",
                      autoLockError ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {autoLockError ?? "When a device isn't used for a while"}
                  </span>
                </div>
              </div>
              <Select value={String(autoLock)} onValueChange={(v) => void saveAutoLock(Number(v))}>
                <SelectTrigger
                  id={autoLockId}
                  className="w-full shrink-0 sm:w-40"
                  aria-label="Lock automatically after"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {AUTO_LOCK_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.value === 0 ? "Never" : `After ${o.label}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          </PrefsGroup>

          {/* Passkey = cara buka kunci tambahan; hanya ada bila kunci aktif. */}
          <PasskeysGroup status={status} />

          <PrefsGroup>
            <ActionRow
              prefix={
                <RowGlyph destructive icon={<LockOpenIcon className="size-[18px]" aria-hidden />} />
              }
              title={`Remove ${label}`}
              subtitle={`KCG Code will open without a ${label}`}
              destructive
              onActivate={() => setDialog("remove")}
            />
          </PrefsGroup>
        </>
      )}

      <LockDialog
        open={dialog === "set"}
        status={status}
        onOpenChange={(o) => setDialog(o ? "set" : null)}
        onDone={(k) => {
          setDialog(null);
          onOk(
            status.protected
              ? "Lock updated. Other devices were signed out."
              : `${k === "pin" ? "PIN" : "Password"} set. This device stays unlocked.`,
          );
        }}
      />
      <RemoveLockDialog
        open={dialog === "remove"}
        status={status}
        onOpenChange={(o) => setDialog(o ? "remove" : null)}
        onDone={() => {
          setDialog(null);
          onOk("Lock removed. KCG Code is no longer protected.");
        }}
      />
    </>
  );
}

function RowGlyph({ icon, destructive }: { icon: ReactNode; destructive?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        destructive ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      {icon}
    </span>
  );
}

// ---------------------------------------------------- dialog: kunci ----

function SecretField({
  label,
  kind,
  value,
  onChange,
  autoComplete,
  autoFocus,
  hint,
}: {
  label: string;
  kind: LockKind;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) {
      // Tunggu animasi buka dialog agar fokus tidak dicuri kembali.
      const t = setTimeout(() => ref.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);
  return (
    <li className="flex flex-col px-4 py-2 focus-within:bg-muted/30">
      <label htmlFor={id} className="text-[12px] leading-4 text-muted-foreground">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="password"
        inputMode={kind === "pin" ? "numeric" : undefined}
        autoComplete={autoComplete}
        maxLength={kind === "pin" ? 12 : 128}
        value={value}
        onChange={(e) =>
          onChange(kind === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value)
        }
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(
          // 16px di mobile: iOS Safari men-zoom halaman saat fokus ke input < 16px.
          "h-7 w-full bg-transparent text-base outline-none sm:text-[15px]",
          kind === "pin" && "tracking-[0.3em]",
        )}
      />
      {hint && (
        <span id={`${id}-hint`} className="sr-only">
          {hint}
        </span>
      )}
    </li>
  );
}

function LockDialog({
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
    if (kind === "pin" && (secret.length < 6 || secret.length > 12)) {
      return "PIN must be 6–12 digits.";
    }
    if (kind === "password" && secret.length < 8) return "Password must be at least 8 characters.";
    if (secret !== confirm) return `The ${lockLabel(kind)}s don't match.`;
    return null;
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
            <fieldset
              aria-labelledby="lock-kind-label"
              className="grid grid-cols-2 gap-1 rounded-lg border-0 bg-muted p-1"
            >
              {(["pin", "password"] as const).map((k) => (
                <label
                  key={k}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                    kind === k
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name="lock-kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setSecret("");
                      setConfirm("");
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  {k === "pin" ? "PIN" : "Password"}
                </label>
              ))}
            </fieldset>
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

function RemoveLockDialog({
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
