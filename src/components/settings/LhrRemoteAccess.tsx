/**
 * Panel Remote access via localhost.run — tanpa akun, lewat `ssh` bawaan OS.
 *
 * Satu kartu: status + tombol Turn on/off, lalu QR + link (sama dengan
 * penyedia bawaan) saat online. Alamat gratis berubah tiap beberapa jam /
 * tiap sambung ulang — dijelaskan singkat di kartu agar pengguna tidak kaget.
 * Log koneksi di bagian lipat untuk pemecahan masalah.
 */
import {
  ChevronDownIcon,
  CircleAlertIcon,
  GlobeIcon,
  InfoIcon,
  LockIcon,
  PowerIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiErrorMessage, apiFetch } from "@/lib/api";
import { settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { LhrStatus } from "@/server/services/tunnel-lhr";

const BUSY: LhrStatus["phase"][] = ["starting", "connecting", "reconnecting"];

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export interface LhrRemoteAccessProps {
  protectedApp: boolean;
  /** Komponen bersama dari panel penyedia bawaan (QR + link, log). */
  LiveAddress: (p: { url: string }) => ReactNode;
  LogPanel: (p: { endpoint?: string }) => ReactNode;
  /** Buka konfirmasi mematikan (halaman bisa terputus bila dibuka lewat link ini). */
  onRequestStop: (stop: () => Promise<void>, viaThisLink: boolean) => void;
  /** Pindah ke penyedia yang direkomendasikan (KCG Code link). */
  onUseRecommended: () => void;
}

export function LhrRemoteAccess({
  protectedApp,
  LiveAddress,
  LogPanel,
  onRequestStop,
  onUseRecommended,
}: LhrRemoteAccessProps) {
  const { navigate } = useRouter();
  const [s, setS] = useState<LhrStatus | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/tunnel/lhr");
      setS(((await res.json()) as { lhr: LhrStatus }).lhr);
    } catch {
      /* poll berikutnya mencoba lagi */
    }
  }, []);

  const active = s !== null && BUSY.includes(s.phase);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), active ? 1500 : 5000);
    return () => clearInterval(id);
  }, [load, active]);

  const start = async () => {
    setBusy("start");
    try {
      const res = await apiFetch("/api/tunnel/lhr/start", { method: "POST", body: "{}" });
      setS(((await res.json()) as { lhr: LhrStatus }).lhr);
    } catch (e) {
      toast.error(errorText(e, "Couldn't turn on remote access."));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    try {
      const res = await apiFetch("/api/tunnel/lhr/stop", { method: "POST", body: "{}" });
      setS(((await res.json()) as { lhr: LhrStatus }).lhr);
      toast.success("Remote access turned off.");
    } catch (e) {
      toast.error(errorText(e, "Couldn't turn off remote access."));
    } finally {
      setBusy(null);
    }
  };

  if (!s) {
    return (
      <PrefsGroup>
        <li className="flex min-h-14 items-center justify-center" role="status">
          <Spinner className="size-5 text-muted-foreground" />
          <span className="sr-only">Loading remote access…</span>
        </li>
      </PrefsGroup>
    );
  }

  const running = s.enabled && s.phase !== "stopped";
  const online = s.phase === "online" && s.url !== null;
  const viaThisLink = s.url !== null && sameOrigin(s.url);

  let tone: "success" | "busy" | "warning" | "muted" = "muted";
  let title = "Remote access is off";
  let body =
    "Turn it on to get a temporary link for opening KCG Code on your phone. No account needed.";
  if (!protectedApp) {
    tone = "warning";
    title = "Set a PIN or password first";
    body = "For your safety, remote access only works when KCG Code is locked.";
  } else if (s.phase === "error") {
    tone = "warning";
    title = "Couldn't connect";
    body = s.error ? apiErrorMessage(s.error) : "Check your internet connection and try again.";
  } else if (online) {
    tone = "success";
    title = "Remote access is on";
    body = "Anyone opening your link still needs your PIN or password.";
  } else if (running) {
    tone = "busy";
    title = s.phase === "reconnecting" ? "Reconnecting…" : "Turning on…";
    body = "Getting a link from localhost.run. This usually takes a few seconds.";
  }

  let action: ReactNode;
  if (!protectedApp) {
    action = (
      <Button type="button" size="sm" onClick={() => navigate(settingsPath("security"))}>
        <LockIcon data-icon="inline-start" />
        Set up lock
      </Button>
    );
  } else if (running) {
    action = (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => onRequestStop(stop, viaThisLink)}
        className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
      >
        {busy === "stop" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PowerIcon data-icon="inline-start" />
        )}
        Turn off
      </Button>
    );
  } else {
    action = (
      <Button type="button" size="sm" disabled={busy !== null} onClick={() => void start()}>
        {busy === "start" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PowerIcon data-icon="inline-start" />
        )}
        {s.phase === "error" ? "Try again" : "Turn on"}
      </Button>
    );
  }

  return (
    <>
      <PrefsGroup id="remote">
        <ActionRow
          prefix={<StatusDot tone={tone} />}
          title={<span className="font-medium">{title}</span>}
          subtitle={<span role="status">{body}</span>}
          suffix={action}
        />
        {online && s.url && <LiveAddress url={s.url} />}
      </PrefsGroup>

      {/* Catatan ala AdwActionRow biasa: tanpa latar khusus, satu tombol datar. */}
      <PrefsGroup>
        <ActionRow
          prefix={
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <InfoIcon className="size-[18px]" aria-hidden />
            </span>
          }
          title="The link changes often"
          subtitle="It changes every few hours and whenever the connection restarts. KCG Code link keeps the same address."
          stack
          suffix={
            <Button type="button" variant="outline" size="sm" onClick={onUseRecommended}>
              Use KCG Code link
            </Button>
          }
        />
      </PrefsGroup>

      <Collapsible
        open={showLog}
        onOpenChange={setShowLog}
        className="overflow-hidden rounded-xl border bg-card shadow-xs"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset data-[state=open]:bg-muted/50"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <TerminalSquareIcon className="size-[18px]" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] leading-5">Connection log</span>
              <span className="text-[13px] leading-snug text-muted-foreground">
                Technical details that can help when troubleshooting
              </span>
            </span>
            <ChevronDownIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                showLog && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t">
          <ul>{showLog && <LogPanel endpoint="/api/tunnel/lhr/logs" />}</ul>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function StatusDot({ tone }: { tone: "success" | "busy" | "warning" | "muted" }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "busy" && "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        tone === "warning" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {tone === "busy" ? (
        <Spinner className="size-5" />
      ) : tone === "warning" ? (
        <CircleAlertIcon className="size-5" aria-hidden />
      ) : (
        <GlobeIcon className="size-5" aria-hidden />
      )}
    </span>
  );
}
