/**
 * Grup Settings "Remote access": tunnel publik `https://<name>.<domain>`.
 *
 * Alur UI (device authorization): Get started -> tampil kode + tautan/QR ->
 * pengguna login Google & menyetujui di halaman API tunnel (boleh
 * dari HP) -> kcgcode tersambung dan tunnel langsung menyala. Status di-poll
 * dari `/api/tunnel`; token & secret tidak pernah dikirim ke browser.
 *
 * Bahasa UI sengaja non-teknis (tanpa "tunnel", "secret", "frpc"): istilah
 * teknis & aksi jarang dipakai disimpan di bagian "Advanced" yang tertutup.
 *
 * Susunan halaman (satu hal per grup, ringkas di HP):
 * 1. AdwSwitchRow "Remote access" + status satu frasa.
 * 2. "Your link" (saat online): QR (desktop), baris link + salin/buka;
 *    di HP: "Share link" + QR dilipat di baris expander.
 * 3. Akun Google tertaut.
 * 4. "Connection method" (pilihan penyedia — jarang diganti, jadi di bawah).
 * 5. "Advanced options" tertutup.
 */
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  QrCodeIcon,
  RefreshCwIcon,
  Settings2Icon,
  Share2Icon,
  TerminalSquareIcon,
  UnplugIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { encode } from "uqr";
import { LhrRemoteAccess } from "@/components/settings/LhrRemoteAccess";
import { ActionRow, ExpanderRow, PrefsGroup, RowBadge } from "@/components/settings/prefs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiErrorMessage, apiFetch } from "@/lib/api";
import { settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { TunnelPhase, TunnelStatus } from "@/server/services/tunnel";

const BUSY_PHASES: TunnelPhase[] = ["starting", "connecting", "reconnecting"];

const DESCRIPTION = "Open KCG Code from your phone or another computer, even when you're away.";

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

async function readTunnel(res: Response): Promise<TunnelStatus> {
  return ((await res.json()) as { tunnel: TunnelStatus }).tunnel;
}

/** Penyedia remote access (sinkron dengan `TunnelProvider` di server). */
type Provider = "kcg" | "lhr";

/**
 * Pembungkus Remote access: pemilih penyedia (KCG Code bawaan / localhost.run)
 * lalu panel penyedia terpilih. Hanya satu tunnel aktif — berpindah
 * penyedia mematikan yang lain di server (`PUT /api/tunnel/provider`).
 */
/** Ringkasan status kedua penyedia untuk kartu pilihan (bukan detail panel). */
interface ProviderOverview {
  provider: Provider;
  /** URL publik penyedia yang sedang menyala, null bila tidak ada. */
  liveUrl: string | null;
  live: Provider | null;
}

function readOverview(b: {
  provider?: Provider;
  tunnel?: TunnelStatus;
  lhr?: { enabled: boolean; phase: string; url: string | null };
}): ProviderOverview {
  const kcgOn = !!b.tunnel && b.tunnel.enabled && b.tunnel.phase !== "stopped";
  const lhrOn = !!b.lhr && b.lhr.enabled && b.lhr.phase !== "stopped";
  const live: Provider | null = kcgOn ? "kcg" : lhrOn ? "lhr" : null;
  return {
    provider: b.provider === "lhr" ? "lhr" : "kcg",
    live,
    liveUrl:
      live === "kcg"
        ? (b.tunnel?.account?.url ?? null)
        : live === "lhr"
          ? (b.lhr?.url ?? null)
          : null,
  };
}

export function RemoteAccessGroup({ protectedApp }: { protectedApp: boolean }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [live, setLive] = useState<{ provider: Provider | null; url: string | null }>({
    provider: null,
    url: null,
  });
  const [switching, setSwitching] = useState(false);
  /** Pindah penyedia saat yang lain menyala -> minta konfirmasi dulu. */
  const [pendingSwitch, setPendingSwitch] = useState<Provider | null>(null);
  /** Konfirmasi mematikan localhost.run (dialog yang sama dengan penyedia bawaan). */
  const [lhrStop, setLhrStop] = useState<{ run: () => Promise<void>; via: boolean } | null>(null);
  const [lhrStopping, setLhrStopping] = useState(false);

  const refresh = useCallback(async (): Promise<ProviderOverview | null> => {
    try {
      const o = readOverview(await (await apiFetch("/api/tunnel")).json());
      setLive({ provider: o.live, url: o.liveUrl });
      return o;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh().then((o) => {
      if (!cancelled) setProvider((cur) => cur ?? o?.provider ?? "kcg");
    });
    // Status "On" di kartu ikut berubah saat tunnel dinyalakan/dimatikan di panel.
    const id = setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refresh]);

  const applySwitch = async (next: Provider) => {
    setSwitching(true);
    try {
      await apiFetch("/api/tunnel/provider", {
        method: "PUT",
        body: JSON.stringify({ provider: next }),
      });
      setProvider(next);
      await refresh();
    } catch (e) {
      toast.error(errorText(e, "Couldn't switch the remote access option."));
    } finally {
      setSwitching(false);
      setPendingSwitch(null);
    }
  };

  const choose = async (next: Provider) => {
    if (next === provider || switching) return;
    // Status terbaru: jangan mematikan tunnel yang menyala tanpa bertanya.
    const o = await refresh();
    if (o?.live && o.live !== next) setPendingSwitch(next);
    else void applySwitch(next);
  };

  // Pilihan penyedia dirender panel penyedia di posisinya (sebelum Advanced).
  const methodPicker = (
    <ProviderPicker
      value={provider}
      live={live.provider}
      disabled={switching}
      onChange={(p) => void choose(p)}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="px-1 text-[13px] leading-snug text-muted-foreground">{DESCRIPTION}</p>
      <SwitchDialog
        to={pendingSwitch}
        viaTunnel={live.url !== null && sameOrigin(live.url)}
        busy={switching}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={(p) => void applySwitch(p)}
      />
      {provider === null ? (
        <PrefsGroup>
          <li className="flex min-h-14 items-center justify-center" role="status">
            <Spinner className="size-5 text-muted-foreground" />
            <span className="sr-only">Loading remote access…</span>
          </li>
        </PrefsGroup>
      ) : provider === "lhr" ? (
        <LhrRemoteAccess
          protectedApp={protectedApp}
          LiveAddress={LiveAddress}
          LogPanel={LogPanel}
          onRequestStop={(run, via) => setLhrStop({ run, via })}
          methodPicker={methodPicker}
        />
      ) : (
        <KcgRemoteAccess protectedApp={protectedApp} methodPicker={methodPicker} />
      )}
      <ConfirmDialog
        kind={lhrStop ? "stop" : null}
        viaTunnel={lhrStop?.via ?? false}
        busy={lhrStopping}
        onOpenChange={(open) => !open && setLhrStop(null)}
        onConfirm={() => {
          const job = lhrStop;
          if (!job) return;
          setLhrStopping(true);
          void job.run().finally(() => {
            setLhrStopping(false);
            setLhrStop(null);
            void refresh();
          });
        }}
      />
    </div>
  );
}

interface ProviderInfo {
  id: Provider;
  title: string;
  /** Satu kalimat pembeda (gaya subjudul AdwActionRow). */
  subtitle: string;
  recommended?: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "kcg",
    title: "KCG Code link",
    subtitle: "Recommended · fixed address",
    recommended: true,
  },
  {
    id: "lhr",
    title: "localhost.run",
    subtitle: "No account · address changes",
  },
];

const PROVIDER_TITLE: Record<Provider, string> = { kcg: "KCG Code link", lhr: "localhost.run" };

/**
 * Pilihan penyedia sebagai kartu radio (dua kolom di layar lebar).
 * KCG Code link ditandai "Recommended"; penyedia yang sedang menyala
 * diberi penanda "On" agar jelas mana yang aktif sebelum berpindah.
 */
function ProviderPicker({
  value,
  live,
  disabled,
  onChange,
}: {
  value: Provider | null;
  live: Provider | null;
  disabled: boolean;
  onChange: (p: Provider) => void;
}) {
  return (
    <section aria-labelledby="remote-provider" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id="remote-provider" className="text-[15px] font-semibold tracking-tight">
          Connection method
        </h2>
      </div>
      {/* Boxed list ala AdwPreferencesGroup: satu baris radio per penyedia
          (AdwActionRow + GtkCheckButton grup). Radio native di dalam label:
          panah atas/bawah & Spasi bawaan browser. */}
      <fieldset
        aria-labelledby="remote-provider"
        disabled={disabled || value === null}
        className="m-0 min-w-0 overflow-hidden rounded-xl border bg-card p-0 shadow-xs"
      >
        <ul className="flex flex-col divide-y">
          {PROVIDERS.map((p) => {
            const selected = value === p.id;
            return (
              <li key={p.id}>
                <label
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors",
                    "hover:bg-muted/60 active:bg-muted has-[:focus-visible]:bg-muted/60",
                    "has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:disabled]:hover:bg-transparent",
                  )}
                >
                  <input
                    type="radio"
                    name="remote-provider"
                    value={p.id}
                    checked={selected}
                    onChange={() => onChange(p.id)}
                    className="peer sr-only"
                  />
                  {/* Radio GTK4: lingkaran, terisi aksen + titik saat dipilih. */}
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40",
                      selected ? "border-primary bg-primary" : "border-muted-foreground/45",
                    )}
                  >
                    {selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
                    <span className="text-[15px] leading-5">{p.title}</span>
                    <span className="text-[13px] leading-snug text-muted-foreground">
                      {p.subtitle}
                    </span>
                  </span>
                  {live === p.id && <RowBadge tone="success">On</RowBadge>}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </section>
  );
}

/** Konfirmasi pindah penyedia saat penyedia lain sedang menyala. */
function SwitchDialog({
  to,
  viaTunnel,
  busy,
  onCancel,
  onConfirm,
}: {
  to: Provider | null;
  viaTunnel: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (p: Provider) => void;
}) {
  // Simpan tujuan terakhir agar teks tidak hilang saat animasi tutup.
  const [last, setLast] = useState<Provider>("kcg");
  if (to && to !== last) setLast(to);
  const target = to ?? last;
  const from: Provider = target === "kcg" ? "lhr" : "kcg";

  return (
    <AlertDialog open={to !== null} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to {PROVIDER_TITLE[target]}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only one link can be on at a time, so your {PROVIDER_TITLE[from]} link will turn off and
            stop working. You can turn on {PROVIDER_TITLE[target]} right after.
            {viaTunnel && (
              <>
                {" "}
                <strong className="font-medium text-foreground">
                  You're using this link right now, so this page will close its connection.
                </strong>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(target);
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Switch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function KcgRemoteAccess({
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

  if (!t) {
    return (
      <PrefsGroup>
        <li className="flex min-h-14 items-center justify-center" role="status">
          <Spinner className="size-5 text-muted-foreground" />
          <span className="sr-only">Loading remote access…</span>
        </li>
      </PrefsGroup>
    );
  }

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

/**
 * AdwSwitchRow: ikon, judul + status di subjudul, switch di kanan. Seluruh
 * baris adalah label switch (klik di mana saja mengubahnya).
 */
function SwitchRow({
  id,
  icon,
  title,
  subtitle,
  checked,
  disabled,
  busy,
  onChange,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-14 items-center gap-3 px-4 py-2.5",
          !disabled && "cursor-pointer",
        )}
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
          <span className="text-[15px] leading-5">{title}</span>
          <span role="status" className="text-[13px] leading-snug text-muted-foreground">
            {subtitle}
          </span>
        </span>
        {busy && <Spinner className="size-4 text-muted-foreground" aria-hidden />}
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </label>
    </li>
  );
}

/** `true` bila halaman ini sedang dibuka lewat alamat tunnel. */
function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ status ----

type Tone = "success" | "busy" | "warning" | "muted";

function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "busy" && "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        tone === "warning" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        tone === "muted" && "bg-muted text-muted-foreground",
        className,
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

// --------------------------------------------------------- not linked ----

function SetupSteps({
  protectedApp,
  error,
  busy,
  onStart,
}: {
  protectedApp: boolean;
  error: string | null;
  busy: string | null;
  onStart: () => void;
}) {
  const { navigate } = useRouter();
  return (
    <li className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-start gap-3">
        <StatusIcon tone="muted" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[15px] font-medium">Set up remote access</p>
          <p className="text-[13px] text-muted-foreground">
            It takes about a minute. You'll get your own link to open KCG Code from anywhere.
          </p>
        </div>
      </div>

      <ol className="flex flex-col gap-3 pl-1">
        <Step
          n={1}
          done={protectedApp}
          title="Lock KCG Code with a PIN or password"
          subtitle={
            protectedApp ? "Done." : "This keeps others out when your link is shared online."
          }
          action={
            !protectedApp && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate(settingsPath("security"))}
              >
                Set up lock
              </Button>
            )
          }
        />
        <Step
          n={2}
          title="Sign in with Google"
          subtitle="You can do this on your phone. We only use it to give you a personal link."
          action={
            <Button
              type="button"
              size="sm"
              disabled={busy !== null || !protectedApp}
              onClick={onStart}
            >
              {busy === "connect" && <Spinner data-icon="inline-start" />}
              Get started
            </Button>
          }
        />
      </ol>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {apiErrorMessage(error)}
        </p>
      )}
    </li>
  );
}

function Step({
  n,
  done,
  title,
  subtitle,
  action,
}: {
  n: number;
  done?: boolean;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
          done
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {done ? <CheckIcon className="size-3.5" /> : n}
      </span>
      <div className="flex min-w-[min(100%,12rem)] flex-1 flex-col">
        <span className={cn("text-[14px]", done && "text-muted-foreground line-through")}>
          <span className="sr-only">
            Step {n}
            {done ? " (done)" : ""}:{" "}
          </span>
          {title}
        </span>
        <span className="text-[12.5px] text-muted-foreground">{subtitle}</span>
      </div>
      {action && <div className="ml-9 shrink-0 sm:ml-0">{action}</div>}
    </li>
  );
}

/** Kode + tautan + QR selama menunggu persetujuan di VPS. */
function PairingRow({
  pairing,
  busy,
  onCancel,
}: {
  pairing: NonNullable<TunnelStatus["pairing"]>;
  busy: boolean;
  onCancel: () => void;
}) {
  const [left, setLeft] = useState(() => Math.max(0, pairing.expiresAt - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, pairing.expiresAt - Date.now())), 1000);
    return () => clearInterval(id);
  }, [pairing.expiresAt]);
  const mm = Math.floor(left / 60_000);
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");

  return (
    <li className="flex flex-col items-center gap-5 px-4 py-5 text-center sm:flex-row sm:items-start sm:text-left">
      <QrCode
        value={pairing.verificationUriComplete}
        label="QR code to open the sign-in page on your phone"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="text-[15px] font-medium">Sign in to finish</p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-left text-[13px] text-muted-foreground marker:text-foreground/70">
          <li>
            Scan the code with your phone camera, or{" "}
            <a
              href={pairing.verificationUriComplete}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              open the sign-in page
            </a>
            .
          </li>
          <li>Sign in with your Google account.</li>
          <li>Make sure the page shows the same code as below, then tap Approve.</li>
        </ol>
        <p className="rounded-lg bg-muted px-3 py-2 text-center font-mono text-2xl font-semibold tracking-[0.2em]">
          <span className="sr-only">Code: </span>
          {pairing.userCode}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-between">
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground" role="status">
            <Spinner className="size-3.5" />
            Waiting for you to approve · {mm}:{ss} left
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </li>
  );
}

/** QR sebagai SVG murni (tanpa innerHTML). */
function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { data, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    return { data: qr.data, size: qr.size };
  }, [value]);
  const path = useMemo(() => {
    let d = "";
    for (let y = 0; y < data.length; y++) {
      const row = data[y] ?? [];
      for (let x = 0; x < row.length; x++) if (row[x]) d += `M${x} ${y}h1v1h-1z`;
    }
    return d;
  }, [data]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("size-40 shrink-0 rounded-lg bg-white p-1", className)}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

// ------------------------------------------------------------ address ----

/**
 * Area QR + link. Hanya tampil utuh saat online; selain itu diganti
 * placeholder seukuran QR berisi ikon, keterangan, dan aksi utama di tengah
 * (Turn on / Try again / Set up lock) agar tata letak tidak "melompat".
 */
/**
 * Baris "Your link" (dipakai kedua penyedia, di dalam boxed list):
 * - desktop: QR selalu tampil (cara tercepat pindah ke HP);
 * - baris link (mono, terpotong) + tombol salin & buka;
 * - HP: "Share link" (Web Share API) dan QR dilipat di baris expander —
 *   pengguna sudah di HP, QR jarang dibutuhkan.
 */
function LiveAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API butuh konteks aman (HTTPS / localhost).
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  };

  // Web Share API (umumnya HP): kirim link lewat WhatsApp / email / dll.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = async () => {
    try {
      await navigator.share({ title: "KCG Code", url });
    } catch {
      /* dibatalkan pengguna */
    }
  };
  const host = url.replace(/^https?:\/\//, "");

  return (
    <>
      <li className="hidden justify-center py-5 sm:flex">
        <QrCode value={url} label="QR code of your remote access link" className="size-40" />
      </li>
      <li className="flex min-h-14 items-center gap-2 py-2 pr-2 pl-4">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate font-mono text-[14px] hover:underline"
          title={url}
        >
          {host}
        </a>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={copied ? "Copied" : "Copy link"}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon />}
        </Button>
        <Button asChild variant="ghost" size="icon-sm" className="rounded-full">
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open link in new tab">
            <ExternalLinkIcon />
          </a>
        </Button>
      </li>
      {canShare && (
        <ActionRow
          className="sm:hidden"
          prefix={<RowGlyph icon={<Share2Icon className="size-[18px]" aria-hidden />} />}
          title="Share link"
          onActivate={() => void share()}
        />
      )}
      <ExpanderRow
        className="sm:hidden"
        prefix={<RowGlyph icon={<QrCodeIcon className="size-[18px]" aria-hidden />} />}
        title="QR code"
        subtitle="Scan from another device"
      >
        <div className="flex justify-center py-2">
          <QrCode value={url} label="QR code of your remote access link" className="size-44" />
        </div>
      </ExpanderRow>
    </>
  );
}

// ----------------------------------------------------------- advanced ----

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

function RowGlyph({ icon, destructive }: { icon: ReactNode; destructive?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-9 items-center justify-center rounded-full",
        destructive ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      {icon}
    </span>
  );
}

/** Log frpc live (polling bertahap `?from=`). */
function LogPanel({ endpoint = "/api/tunnel/logs" }: { endpoint?: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const next = useRef(0);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await apiFetch(`${endpoint}?from=${next.current}`);
        const body = (await res.json()) as { lines: string[]; next: number };
        if (stop) return;
        next.current = body.next;
        if (body.lines.length > 0) setLines((prev) => [...prev, ...body.lines].slice(-300));
      } catch {
        /* coba lagi di tick berikutnya */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [endpoint]);

  // Ikuti baris terbaru.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll saat baris bertambah
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines.length]);

  return (
    <li className="px-4 py-3">
      <pre
        ref={box}
        role="log"
        aria-label="Connection log"
        className="max-h-56 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all"
      >
        {lines.length === 0 ? "No output yet." : lines.join("\n")}
      </pre>
    </li>
  );
}

// ------------------------------------------------------------ confirm ----

type ConfirmKind = "stop" | "rotate" | "signout";

const CONFIRM_COPY: Record<
  ConfirmKind,
  { title: string; body: string; action: string; destructive: boolean }
> = {
  stop: {
    title: "Turn off remote access?",
    body: "Your link will stop working and any phone or computer using it will be disconnected. You can turn it back on from this computer anytime.",
    action: "Turn off",
    destructive: true,
  },
  rotate: {
    title: "Reset security key?",
    body: "Remote access restarts, so your link stops for a few seconds. Other computers linked to your account will need to sign in again.",
    action: "Reset",
    destructive: false,
  },
  signout: {
    title: "Unlink this computer?",
    body: "Remote access turns off and this computer is removed from your Google account. You can set it up again anytime.",
    action: "Unlink",
    destructive: true,
  },
};

/** Konfirmasi aksi yang sulit dibatalkan dari jarak jauh (mis. dari HP). */
function ConfirmDialog({
  kind,
  viaTunnel,
  busy,
  onOpenChange,
  onConfirm,
}: {
  kind: ConfirmKind | null;
  viaTunnel: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (kind: ConfirmKind) => void;
}) {
  // Simpan salinan terakhir agar teks tidak hilang saat animasi tutup.
  const [last, setLast] = useState<ConfirmKind>("stop");
  if (kind && kind !== last) setLast(kind);
  const copy = CONFIRM_COPY[kind ?? last];
  const cutsSession = viaTunnel && (kind ?? last) !== "rotate";

  return (
    <AlertDialog open={kind !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.body}
            {cutsSession && (
              <>
                {" "}
                <strong className="font-medium text-foreground">
                  You're using this link right now, so this page will close its connection.
                </strong>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={copy.destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(kind ?? last);
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
