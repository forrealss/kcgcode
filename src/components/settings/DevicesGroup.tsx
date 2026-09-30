/**
 * Settings -> Signed-in devices (`/settings/devices`): sesi login per
 * perangkat, bisa di-sign-out satu per satu atau sekaligus.
 */
import { LaptopIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ActionRow, PrefsGroup, RowBadge } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import type { DeviceInfo } from "@/server/services/auth";

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

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

export function DevicesGroup({ onError }: { onError: (t: string) => void }) {
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
