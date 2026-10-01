/**
 * Panel Remote access via localhost.run — tanpa akun, lewat `ssh` bawaan OS.
 *
 * Satu grup ala AdwPreferencesGroup:
 * - AdwSwitchRow "Remote access" (status satu frasa di subjudul),
 * - QR + link saat online (komponen bersama penyedia bawaan),
 * - baris expander "Connection log".
 * Catatan alamat yang berubah + tautan ke KCG Code link jadi footer grup.
 */
import { ChevronDownIcon, GlobeIcon, LockIcon, TerminalSquareIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
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
  const connecting = running && !online && s.phase !== "error";

  // Subjudul: satu kalimat pendek yang menjelaskan keadaan + apa artinya.
  let tone: RowTone = "muted";
  let subtitle: ReactNode = "Get a temporary link to open KCG Code on your phone";
  if (!protectedApp) {
    tone = "warning";
    subtitle = "Set a PIN or password first to keep others out";
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
    subtitle = "On · anyone with the link still needs your PIN or password";
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
    <section aria-label="localhost.run" className="flex flex-col gap-2">
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

        {online && s.url && <LiveAddress url={s.url} />}

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

      {/* Footer grup: catatan singkat + aksi inline. */}
      <p className="px-1 text-[12.5px] leading-snug text-muted-foreground">
        Free addresses change every few hours and after reconnecting.{" "}
        <button
          type="button"
          onClick={onUseRecommended}
          className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          Use KCG Code link
        </button>{" "}
        for one that stays the same.
      </p>
    </section>
  );
}

function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

type RowTone = "success" | "busy" | "warning" | "muted";

/** Ikon bulat di awal baris (sama dengan baris lain di Settings). */
function RowIcon({ tone, children }: { tone: RowTone; children: ReactNode }) {
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
