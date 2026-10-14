/** Panel penyedia bawaan (KCG Code link): tunnel `https://<name>.<domain>`. */
import {
  ChevronDownIcon,
  LockIcon,
  RefreshCwIcon,
  Settings2Icon,
  TerminalSquareIcon,
  UnplugIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRouter } from "@/hooks/useRouter";
import { apiErrorMessage, apiFetch, errorText } from "@/lib/api";
import { settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { TunnelPhase, TunnelStatus } from "@/server/services/tunnel";
import { ConfirmDialog, type ConfirmKind } from "./ConfirmDialog";
import { PairingRow, SetupSteps } from "./KcgSetup";
import { LiveAddress } from "./LiveAddress";
import { LogPanel } from "./LogPanel";
import { LoadingGroup, RowGlyph, StatusIcon, SwitchRow, type Tone } from "./rows";
import { sameOrigin } from "./utils";

const BUSY_PHASES: TunnelPhase[] = ["starting", "connecting", "reconnecting"];

async function readTunnel(res: Response): Promise<TunnelStatus> {
  return ((await res.json()) as { tunnel: TunnelStatus }).tunnel;
}

export function KcgRemoteAccess({
  protectedApp,
  methodPicker,
}: {
  protectedApp: boolean;
  /** Grup "Connection method" — dirender sebelum Advanced. */
  methodPicker: ReactNode;
}) {
  const { navigate } = useRouter();
  const [t, setT] = useState<TunnelStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);

  const load = useCallback(async () => {
    try {
      setT(await readTunnel(await apiFetch("/api/tunnel")));
    } catch {
      /* dilaporkan saat aksi; poll berikutnya mencoba lagi */
    }
  }, []);

  // Poll lebih rapat saat pairing / tunnel sedang berjalan.
  const active = t !== null && (t.pairing !== null || BUSY_PHASES.includes(t.phase));
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), active ? 1500 : 5000);
    return () => clearInterval(id);
  }, [load, active]);

  const act = async (key: string, path: string, okText?: string) => {
    setBusy(key);
    try {
      setT(await readTunnel(await apiFetch(path, { method: "POST", body: "{}" })));
      if (okText) toast.success(okText);
    } catch (e) {
      toast.error(errorText(e, "Something went wrong."));
      void load();
    } finally {
      setBusy(null);
    }
  };

  if (!t) return <LoadingGroup />;

  // ---- API tunnel belum diatur (KCG_TUNNEL_API_URL / build) ----
  if (!t.configured) {
    return (
      <>
        <PrefsGroup id="remote">
          <ActionRow
            prefix={<StatusIcon tone="muted" />}
            title="Not available in this version"
            subtitle={
              <>
                Remote access hasn't been set up for this copy of KCG Code. If you manage it, set{" "}
                <code className="font-mono text-[12px]">KCG_TUNNEL_API_URL</code> and restart.
              </>
            }
          />
        </PrefsGroup>
        {methodPicker}
      </>
    );
  }

  // ---- belum tersambung ----
  if (!t.account) {
    return (
      <>
        <PrefsGroup id="remote">
          {t.pairing ? (
            <PairingRow
              pairing={t.pairing}
              busy={busy !== null}
              onCancel={() => void act("cancel", "/api/tunnel/connect/cancel")}
            />
          ) : (
            <SetupSteps
              protectedApp={protectedApp}
              error={t.error}
              busy={busy}
              onStart={() => void act("connect", "/api/tunnel/connect")}
            />
          )}
        </PrefsGroup>
        {methodPicker}
      </>
    );
  }

  // ---- tersambung ----
  const running = t.enabled && t.phase !== "stopped";
  // Dibuka lewat alamat tunnel? Mematikan / memutus tunnel akan memutus sesi ini.
  const viaTunnel = sameOrigin(t.account.url);

  const runConfirmed = async (key: ConfirmKind) => {
    if (key === "stop") await act("stop", "/api/tunnel/stop", "Remote access turned off.");
    if (key === "rotate") await act("rotate", "/api/tunnel/rotate-secret", "Security key reset.");
    if (key === "signout")
      await act("signout", "/api/tunnel/signout", "This computer was unlinked.");
    setConfirm(null);
  };

  const online = running && t.phase === "online" && protectedApp;
  const account = t.account;

  // Subjudul switch: satu frasa yang menjelaskan keadaan (pola penyedia
  // localhost.run). Status lama yang memenuhi kartu (ikon besar, kotak QR
  // kosong, tombol terpisah) dilebur ke sini.
  let tone: Tone;
  let subtitle: ReactNode;
  if (!protectedApp) {
    tone = "warning";
    subtitle = "Needs a PIN or password first";
  } else if (running && t.phase === "error") {
    tone = "warning";
    subtitle = (
      <span className="text-destructive">
        {t.error ? apiErrorMessage(t.error) : "Couldn't connect. Check your internet."}
      </span>
    );
  } else if (online) {
    tone = "success";
    subtitle = "On · PIN still required";
  } else if (running || busy === "start") {
    tone = "busy";
    subtitle = t.phase === "reconnecting" ? "Reconnecting…" : "Turning on…";
  } else {
    tone = "muted";
    subtitle = "Off";
  }

  // Mematikan selalu dikonfirmasi: dari HP tidak bisa dinyalakan lagi.
  const toggle = (next: boolean) => {
    if (next) void act("start", "/api/tunnel/start");
    else setConfirm("stop");
  };

  return (
    <>
      <PrefsGroup id="remote">
        <SwitchRow
          id="kcg-remote-switch"
          icon={<StatusIcon tone={tone} />}
          title="Remote access"
          subtitle={subtitle}
          checked={running || busy === "start"}
          disabled={!protectedApp || busy !== null}
          busy={busy === "start" || busy === "stop"}
          onChange={toggle}
        />
        {!protectedApp && (
          <ActionRow
            prefix={<RowGlyph icon={<LockIcon className="size-[18px]" aria-hidden />} />}
            title="Set up app lock"
            subtitle="Add a PIN or password in Security"
            onActivate={() => navigate(settingsPath("security"))}
          />
        )}
        {protectedApp && running && t.phase === "error" && (
          <ActionRow
            prefix={<RowGlyph icon={<RefreshCwIcon className="size-[18px]" aria-hidden />} />}
            title="Try again"
            disabled={busy !== null}
            onActivate={() => void act("start", "/api/tunnel/start")}
          />
        )}
      </PrefsGroup>

      {online && (
        <PrefsGroup title="Your link">
          <LiveAddress url={account.url} />
        </PrefsGroup>
      )}

      <PrefsGroup title="Account">
        <ActionRow
          title="Google account"
          subtitle={<span className="break-all">{account.email}</span>}
        />
      </PrefsGroup>

      {methodPicker}

      <AdvancedSection
        busy={busy !== null}
        onRotate={() => setConfirm("rotate")}
        onUnlink={() => setConfirm("signout")}
      />

      <ConfirmDialog
        kind={confirm}
        viaTunnel={viaTunnel}
        busy={busy !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        onConfirm={(k) => void runConfirmed(k)}
      />
    </>
  );
}

function AdvancedSection({
  busy,
  onRotate,
  onUnlink,
}: {
  busy: boolean;
  onRotate: () => void;
  onUnlink: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);

  return (
    // Expander row ala AdwExpanderRow: header di dalam kartu, isi terbuka di
    // kartu yang sama (bukan tautan teks kecil yang mudah terlewat).
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          // Saat terbuka header diberi latar agar terbaca sebagai judul menu.
          className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset data-[state=open]:bg-muted/50 data-[state=open]:hover:bg-muted/70"
        >
          <RowGlyph icon={<Settings2Icon className="size-[18px]" aria-hidden />} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] leading-5">Advanced options</span>
            <span className="text-[13px] leading-snug text-muted-foreground">
              Security key, connection log, and unlinking this computer
            </span>
          </span>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <ul className="flex flex-col divide-y">
          <ActionRow
            prefix={<RowGlyph icon={<RefreshCwIcon className="size-[18px]" aria-hidden />} />}
            title="Reset security key"
            subtitle="Only needed if you think someone else got access. Your link stays the same."
            disabled={busy}
            onActivate={onRotate}
          />
          <ActionRow
            prefix={<RowGlyph icon={<TerminalSquareIcon className="size-[18px]" aria-hidden />} />}
            title="Connection log"
            subtitle="Technical details that can help when troubleshooting"
            suffix={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={showLog}
                onClick={() => setShowLog((v) => !v)}
              >
                {showLog ? "Hide" : "Show"}
              </Button>
            }
          />
          {showLog && <LogPanel />}
          <ActionRow
            prefix={
              <RowGlyph destructive icon={<UnplugIcon className="size-[18px]" aria-hidden />} />
            }
            title="Unlink this computer"
            subtitle="Turns remote access off and removes this computer from your Google account"
            destructive
            disabled={busy}
            onActivate={onUnlink}
          />
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
