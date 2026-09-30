/**
 * Halaman Settings (`/settings`) — tata letak ala GNOME Settings (libadwaita):
 * kolom sempit di tengah, grup berjudul berisi "boxed list" (baris berpemisah
 * dengan judul/subjudul di kiri dan kontrol/chevron di kanan). Aksi yang butuh
 * input (atur/ganti/hapus kunci) dibuka di dialog, seperti GNOME.
 *
 * - Profil: avatar besar di tengah dengan tombol pensil (pilih avatar bawaan
 *   / upload foto), nickname sebagai entry row.
 * - Security (`#security`): kunci aplikasi, jenis kunci, kunci otomatis.
 * - Remote access (`#remote`): tunnel publik lewat Google sign-in.
 * - Devices: sesi login per perangkat.
 */
import {
  KeyRoundIcon,
  LaptopIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AvatarEditor } from "@/components/auth/AvatarEditor";
import { ActionRow, EntryRow, PrefsGroup, RowBadge } from "@/components/settings/prefs";
import { RemoteAccessGroup } from "@/components/settings/RemoteAccessGroup";
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
import { lockLabel, refreshAuth, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { AuthStatus, DeviceInfo } from "@/server/services/auth";

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

export function SettingsPage() {
  const auth = useAuth();
  const status = auth.phase === "ready" ? auth.status : null;
  const ok = useCallback((text: string) => toast.success(text), []);
  const error = useCallback((text: string) => toast.error(text), []);

  // Tautan `#security` (dari banner "Not protected") -> gulir ke bagiannya.
  useEffect(() => {
    if (window.location.hash === "#security") {
      document.getElementById("security")?.scrollIntoView({ block: "start" });
    }
  }, []);

  if (!status) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Spinner className="size-6 text-muted-foreground" />
        <span className="sr-only">Loading settings…</span>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-8 pb-10">
      <ProfileHeader status={status} onOk={ok} onError={error} />
      <SecurityGroup status={status} onOk={ok} />
      <RemoteAccessGroup protectedApp={status.protected} />
      {status.protected && <DevicesGroup onError={error} />}
    </div>
  );
}

// ----------------------------------------------------------- profile ----

function ProfileHeader({
  status,
  onOk,
  onError,
}: {
  status: AuthStatus;
  onOk: (t: string) => void;
  onError: (t: string) => void;
}) {
  const saveNickname = async (next: string): Promise<string | null> => {
    try {
      await apiFetch("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname: next || null }),
      });
      await refreshAuth();
      onOk("Nickname saved.");
      return null;
    } catch (err) {
      return errorText(err, "Couldn't save nickname.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <AvatarEditor
          profile={status.profile}
          onResult={(r) => ("ok" in r ? onOk(r.ok) : onError(r.error))}
        />
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {status.profile.nickname ?? "Your profile"}
          </h1>
          <p className="text-sm text-muted-foreground">Shown on the lock screen and sidebar.</p>
        </div>
      </div>

      <PrefsGroup>
        <EntryRow
          title="Nickname"
          value={status.profile.nickname ?? ""}
          placeholder="Add a nickname"
          maxLength={40}
          autoComplete="nickname"
          onSave={saveNickname}
        />
      </PrefsGroup>
    </div>
  );
}

// ---------------------------------------------------------- security ----

function SecurityGroup({ status, onOk }: { status: AuthStatus; onOk: (t: string) => void }) {
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

  return (
    <>
      {!status.protected && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <ShieldAlertIcon
            className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400"
            aria-hidden
          />
          <div className="flex flex-col gap-0.5">
            <p className="text-[15px] font-medium text-amber-900 dark:text-amber-200">
              KCG Code is not protected
            </p>
            <p className="text-[13px] text-amber-900/80 dark:text-amber-200/80">
              Anyone who can reach this address can control your agents and run commands on this
              machine. Set a lock before exposing it through a tunnel.
            </p>
          </div>
        </div>
      )}

      <PrefsGroup
        id="security"
        title="Security"
        description="Protects KCG Code when it's reachable from other devices."
      >
        <ActionRow
          prefix={
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full",
                status.protected
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {status.protected ? (
                <ShieldCheckIcon className="size-5" aria-hidden />
              ) : (
                <KeyRoundIcon className="size-5" aria-hidden />
              )}
            </span>
          }
          title="App lock"
          subtitle={
            status.protected
              ? "Every device must unlock before it can see or control your agents"
              : "Require a PIN or password to open KCG Code"
          }
          suffix={
            status.protected ? (
              <RowBadge tone="success">On</RowBadge>
            ) : (
              <RowBadge tone="warning">Off</RowBadge>
            )
          }
          onActivate={() => setDialog("set")}
        />
        {status.protected && (
          <>
            <ActionRow
              title={`Change ${lockLabel(kind)}`}
              subtitle={`Currently using a ${lockLabel(kind)}. Other devices will be signed out.`}
              onActivate={() => setDialog("set")}
            />
            <ActionRow
              title="Auto-lock"
              subtitle={autoLockError ?? "Lock each device after this long without activity"}
              htmlFor={autoLockId}
              suffix={
                <Select
                  value={String(autoLock)}
                  onValueChange={(v) => void saveAutoLock(Number(v))}
                >
                  <SelectTrigger id={autoLockId} size="sm" className="min-w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {AUTO_LOCK_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          </>
        )}
      </PrefsGroup>

      {status.protected && (
        <PrefsGroup>
          <ActionRow
            title="Remove lock"
            subtitle="KCG Code will open without a PIN or password"
            destructive
            onActivate={() => setDialog("remove")}
          />
        </PrefsGroup>
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
          "h-7 w-full bg-transparent text-[15px] outline-none",
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
            will be signed out.
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

// ----------------------------------------------------------- devices ----

/** Ringkasan user agent -> "Chrome on Android". */
export function describeDevice(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "Active now";
  const m = Math.round(s / 60);
  if (m < 60) return `Active ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Active ${h} h ago`;
  return `Active ${Math.round(h / 24)} d ago`;
}

function DevicesGroup({ onError }: { onError: (t: string) => void }) {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/auth/devices");
      setDevices(((await res.json()) as { devices: DeviceInfo[] }).devices);
    } catch (err) {
      onError(errorText(err, "Couldn't load devices."));
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (path: string, init: RequestInit) => {
    setBusy(true);
    try {
      await apiFetch(path, init);
      await load();
    } catch (err) {
      onError(errorText(err, "Couldn't sign out the device."));
    } finally {
      setBusy(false);
    }
  };

  const others = devices?.filter((d) => !d.current) ?? [];

  return (
    <PrefsGroup
      title="Signed-in devices"
      description="Devices that have unlocked KCG Code."
      suffix={
        others.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void revoke("/api/auth/devices/revoke-others", { method: "POST" })}
          >
            Sign out others
          </Button>
        ) : undefined
      }
    >
      {devices === null ? (
        <li className="flex min-h-14 items-center justify-center" role="status">
          <Spinner className="size-5 text-muted-foreground" />
        </li>
      ) : (
        devices.map((d) => {
          const info = describeDevice(d.userAgent);
          const Icon = info.mobile ? SmartphoneIcon : LaptopIcon;
          return (
            <ActionRow
              key={d.id}
              prefix={
                <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
              }
              title={info.label}
              subtitle={relativeTime(d.lastSeenAt)}
              suffix={
                d.current ? (
                  <RowBadge>This device</RowBadge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void revoke(`/api/auth/devices/${encodeURIComponent(d.id)}`, {
                        method: "DELETE",
                      })
                    }
                    aria-label={`Sign out ${info.label}`}
                  >
                    Sign out
                  </Button>
                )
              }
            />
          );
        })
      )}
    </PrefsGroup>
  );
}
