/**
 * Panel Remote access via localhost.run — tanpa akun, lewat `ssh` bawaan OS.
 *
 * Susunan sama dengan penyedia bawaan (satu hal per grup):
 * - AdwSwitchRow "Remote access" (status satu frasa di subjudul),
 * - grup "Your link" saat online (komponen bersama penyedia bawaan),
 * - grup "Connection method" (dari pembungkus),
 * - baris expander "Connection log".
 */
import { ChevronDownIcon, GlobeIcon, LockIcon, TerminalSquareIcon } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { usePolling } from "@/hooks/usePolling";
import { useRouter } from "@/hooks/useRouter";
import { apiErrorMessage, apiFetch, errorText } from "@/lib/api";
import { settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { LhrStatus } from "@/server/services/tunnel-lhr";
import { LiveAddress } from "./LiveAddress";
import { LogPanel } from "./LogPanel";
import { LoadingGroup, type Tone } from "./rows";
import { sameOrigin } from "./utils";

const BUSY: LhrStatus["phase"][] = ["starting", "connecting", "reconnecting"];

export interface LhrRemoteAccessProps {
  protectedApp: boolean;
  /** Buka konfirmasi mematikan (halaman bisa terputus bila dibuka lewat link ini). */
  onRequestStop: (stop: () => Promise<void>, viaThisLink: boolean) => void;
  /** Grup "Connection method" — dirender sebelum log. */
  methodPicker: ReactNode;
}

export function LhrRemoteAccess({
  protectedApp,
  onRequestStop,
  methodPicker,
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
  usePolling(load, active ? 1500 : 5000);

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

  if (!s) return <LoadingGroup />;

  const running = s.enabled && s.phase !== "stopped";
  const online = s.phase === "online" && s.url !== null;
  const viaThisLink = s.url !== null && sameOrigin(s.url);
  const connecting = running && !online && s.phase !== "error";

  // Subjudul: satu kalimat pendek yang menjelaskan keadaan + apa artinya.
  let tone: Tone = "muted";
  let subtitle: ReactNode = "Off";
  if (!protectedApp) {
    tone = "warning";
    subtitle = "Needs a PIN or password first";
  } else if (s.phase === "error") {
    tone = "warning";
    subtitle = (
      <span className="text-destructive">
        {s.error
          ? apiErrorMessage(s.error)
          : "Couldn't connect. Check your internet and try again."}
      </span>
    );
  } else if (online) {
    tone = "success";
    subtitle = "On · PIN still required";
  } else if (connecting) {
    tone = "busy";
    subtitle =
      s.phase === "reconnecting"
        ? "Reconnecting to localhost.run…"
        : "Getting a link from localhost.run…";
  }

  const toggle = (next: boolean) => {
    if (next) void start();
    else onRequestStop(stop, viaThisLink);
  };

  return (
    <>
      <PrefsGroup id="remote">
        {/* AdwSwitchRow: judul + status singkat, switch di kanan. */}
        <li>
          <label
            htmlFor="lhr-switch"
            className={cn(
              "flex min-h-14 items-center gap-3 px-4 py-2.5",
              protectedApp && "cursor-pointer",
            )}
          >
            <RowIcon tone={tone}>
              <GlobeIcon />
            </RowIcon>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
              <span className="text-[15px] leading-5">Remote access</span>
              <span role="status" className="text-[13px] leading-snug text-muted-foreground">
                {subtitle}
              </span>
            </span>
            {busy !== null && <Spinner className="size-4 text-muted-foreground" aria-hidden />}
            <Switch
              id="lhr-switch"
              checked={running || busy === "start"}
              disabled={!protectedApp || busy !== null}
              onCheckedChange={toggle}
            />
          </label>
        </li>

        {!protectedApp && (
          <ActionRow
            prefix={
              <RowIcon tone="muted">
                <LockIcon />
              </RowIcon>
            }
            title="Set up app lock"
            subtitle="Add a PIN or password in Security"
            onActivate={() => navigate(settingsPath("security"))}
          />
        )}
      </PrefsGroup>

      {online && s.url && (
        <PrefsGroup
          title="Your link"
          description="This address changes when it reconnects, so it can't be installed as an app on your phone. For that, use KCG Code link — its address stays the same."
        >
          <LiveAddress url={s.url} />
        </PrefsGroup>
      )}

      {methodPicker}

      <PrefsGroup>
        {/* Log teknis dilipat di baris expander (AdwExpanderRow). */}
        <Collapsible asChild open={showLog} onOpenChange={setShowLog}>
          <li>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] leading-5 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset"
              >
                <RowIcon tone="muted">
                  <TerminalSquareIcon />
                </RowIcon>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span>Connection log</span>
                  <span className="text-[13px] leading-snug text-muted-foreground">
                    Technical details for troubleshooting
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
          </li>
        </Collapsible>
      </PrefsGroup>
    </>
  );
}

/** Ikon bulat di awal baris (sama dengan baris lain di Settings). */
function RowIcon({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full [&>svg]:size-[18px]",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "busy" && "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        tone === "warning" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {tone === "busy" ? <Spinner className="size-[18px]" /> : children}
    </span>
  );
}
