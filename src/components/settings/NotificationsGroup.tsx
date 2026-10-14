/**
 * Settings -> Notifications (`/settings/notifications`):
 *
 * - Push notification perangkat ini (Web Push): switch + alasan bila tidak
 *   tersedia (HTTP, iOS belum Add to Home Screen, alamat localhost.run,
 *   izin diblokir), plus tombol kirim notifikasi uji.
 * - Suara di dalam app (`notification.ogg`) — preferensi per perangkat.
 * - Daftar perangkat yang menerima push; perangkat lain bisa dilepas.
 */
import { BellIcon, BellOffIcon, LaptopIcon, SmartphoneIcon, Volume2Icon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { describeDevice } from "@/components/settings/DevicesGroup";
import { ActionRow, PrefsGroup, RowBadge, SwitchRow } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { playNotificationSound, setSoundEnabled, soundEnabled } from "@/lib/agent-notify";
import { apiFetch, errorText } from "@/lib/api";
import {
  disablePush,
  enablePush,
  type PushSupport,
  pushSupport,
  syncPush,
  usePushDevice,
} from "@/lib/push";
import { cn } from "@/lib/utils";
import type { PushDeviceInfo } from "@/server/services/notifications";

/** Alasan push tidak tersedia di perangkat ini. */
const UNAVAILABLE: Record<Exclude<PushSupport, "supported">, string> = {
  insecure: "Needs a secure connection. Open KCG Code over HTTPS (Remote access) or on localhost.",
  "ios-install":
    "On iPhone and iPad, add KCG Code to your Home Screen first (Share → Add to Home Screen), then turn this on from the app.",
  ephemeral:
    "Not available on temporary localhost.run links, since the address changes. Use the KCG Code link instead.",
  unsupported: "This browser doesn't support push notifications.",
};

function RowIcon({ tone, children }: { tone: "success" | "muted"; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full [&>svg]:size-[18px]",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function NotificationsGroup({ onError }: { onError: (t: string) => void }) {
  const support = pushSupport();
  const device = usePushDevice();
  const [devices, setDevices] = useState<PushDeviceInfo[] | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === "undefined" ? "default" : Notification.permission,
  );
  /** Aksi berjalan: "toggle", "test", atau id perangkat yang dilepas. */
  const [busy, setBusy] = useState<string | null>(null);
  const [sound, setSound] = useState(soundEnabled);

  const loadDevices = useCallback(async () => {
    try {
      const res = await apiFetch("/api/push/devices");
      setDevices(((await res.json()) as { devices: PushDeviceInfo[] }).devices);
    } catch (e) {
      onError(errorText(e, "Couldn't load devices."));
    }
  }, [onError]);

  // Sinkron dulu agar status "This device" akurat (mis. baru dihapus dari
  // perangkat lain), lalu muat daftar.
  useEffect(() => {
    void syncPush().finally(() => void loadDevices());
  }, [loadDevices]);

  const on = device.deviceId !== null;

  const toggle = async (next: boolean) => {
    setBusy("toggle");
    try {
      if (next) {
        const res = await enablePush();
        setPermission(Notification.permission);
        if (res === "denied") {
          onError("Notifications are blocked. Allow them for this site in your browser settings.");
        }
      } else {
        await disablePush();
      }
      await loadDevices();
    } catch (e) {
      onError(errorText(e, next ? "Couldn't turn on notifications." : "Couldn't turn them off."));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async (id: string) => {
    setBusy("test");
    try {
      await apiFetch(`/api/push/devices/${encodeURIComponent(id)}/test`, { method: "POST" });
      toast.success("Test notification sent.");
    } catch (e) {
      onError(errorText(e, "Couldn't send the test notification."));
      await loadDevices();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await apiFetch(`/api/push/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadDevices();
    } catch (e) {
      onError(errorText(e, "Couldn't remove the device."));
    } finally {
      setBusy(null);
    }
  };

  const toggleSound = (next: boolean) => {
    setSoundEnabled(next);
    setSound(next);
    // Pratinjau — sekaligus "membuka" audio di browser yang butuh interaksi.
    if (next) playNotificationSound();
  };

  const blocked = support === "supported" && permission === "denied" && !on;
  const subtitle =
    support !== "supported"
      ? UNAVAILABLE[support]
      : blocked
        ? "Blocked in your browser. Allow notifications for this site, then try again."
        : on
          ? "On · Permission requests, questions and finished replies"
          : "Get notified even when KCG Code is closed";

  return (
    <>
      <PrefsGroup
        title="Push notifications"
        description="Know when an agent asks for permission, has a question, or finishes, without keeping KCG Code open."
      >
        <SwitchRow
          id="push-switch"
          icon={
            <RowIcon tone={on ? "success" : "muted"}>{on ? <BellIcon /> : <BellOffIcon />}</RowIcon>
          }
          title="Notifications on this device"
          subtitle={subtitle}
          checked={on}
          disabled={support !== "supported" || blocked}
          busy={busy === "toggle"}
          onChange={(next) => void toggle(next)}
        />
        {on && device.deviceId && (
          <ActionRow
            title="Send a test notification"
            subtitle="Lock your phone or switch apps to see it arrive."
            suffix={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => device.deviceId && void sendTest(device.deviceId)}
              >
                {busy === "test" ? <Spinner className="size-4" /> : "Send"}
              </Button>
            }
          />
        )}
      </PrefsGroup>

      <PrefsGroup title="In the app">
        <SwitchRow
          id="sound-switch"
          icon={
            <RowIcon tone="muted">
              <Volume2Icon />
            </RowIcon>
          }
          title="Play a sound"
          subtitle="When an agent needs you or finishes while KCG Code is open on this device."
          checked={sound}
          onChange={toggleSound}
        />
      </PrefsGroup>

      {devices !== null && devices.length > 0 && (
        <PrefsGroup
          id="push-devices"
          title="Devices"
          description="Devices that receive push notifications."
        >
          {devices.map((d) => {
            const info = describeDevice(d.userAgent);
            const Icon = info.mobile ? SmartphoneIcon : LaptopIcon;
            const current = d.id === device.deviceId;
            return (
              <ActionRow
                key={d.id}
                prefix={
                  <RowIcon tone="muted">
                    <Icon />
                  </RowIcon>
                }
                title={info.label}
                subtitle={`Added ${new Date(d.createdAt).toLocaleDateString()}`}
                suffix={
                  current ? (
                    <RowBadge>This device</RowBadge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void remove(d.id)}
                      aria-label={`Stop notifications on ${info.label}`}
                    >
                      Remove
                    </Button>
                  )
                }
              />
            );
          })}
        </PrefsGroup>
      )}
    </>
  );
}
