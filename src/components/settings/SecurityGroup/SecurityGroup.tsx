/**
 * Settings -> Security (`/settings/security`): kunci aplikasi (PIN/password),
 * ganti/hapus kunci lewat dialog, kunci otomatis, passkey, dan perangkat
 * yang sedang login (dulu tab "Devices" sendiri).
 *
 * Dialog pasang/ganti & hapus kunci ada di file sendiri.
 */
import {
  KeyRoundIcon,
  LockIcon,
  LockOpenIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TimerIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { DevicesGroup } from "@/components/settings/DevicesGroup";
import { PasskeysGroup } from "@/components/settings/PasskeysGroup";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch, errorText } from "@/lib/api";
import { lockLabel, refreshAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";
import { LockDialog } from "./LockDialog";
import { RemoveLockDialog } from "./RemoveLockDialog";

const AUTO_LOCK_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
];

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

          {/* Perangkat yang login (dulu tab "Devices" sendiri). */}
          <DevicesGroup onError={(t) => toast.error(t)} />

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
