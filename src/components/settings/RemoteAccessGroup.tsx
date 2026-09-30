/**
 * Grup Settings "Remote access": tunnel publik `https://<name>.<domain>`.
 *
 * Alur UI (device authorization): Connect -> tampil kode + tautan/QR ->
 * pengguna login Google & menyetujui di halaman API tunnel (boleh
 * dari HP) -> kcgcode tersambung dan tunnel langsung menyala. Status di-poll
 * dari `/api/tunnel`; token & secret tidak pernah dikirim ke browser.
 */
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshCwIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { encode } from "uqr";
import { ActionRow, PrefsGroup, RowBadge } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiErrorMessage, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { TunnelPhase, TunnelStatus } from "@/server/services/tunnel";

const BUSY_PHASES: TunnelPhase[] = ["starting", "connecting", "reconnecting"];

const PHASE_LABEL: Record<TunnelPhase, string> = {
  signed_out: "Off",
  stopped: "Off",
  starting: "Starting…",
  connecting: "Connecting…",
  online: "Online",
  reconnecting: "Reconnecting…",
  error: "Error",
};

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

async function readTunnel(res: Response): Promise<TunnelStatus> {
  return ((await res.json()) as { tunnel: TunnelStatus }).tunnel;
}

export function RemoteAccessGroup({ protectedApp }: { protectedApp: boolean }) {
  const [t, setT] = useState<TunnelStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

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
      <PrefsGroup title="Remote access">
        <li className="flex min-h-14 items-center justify-center" role="status">
          <Spinner className="size-5 text-muted-foreground" />
          <span className="sr-only">Loading remote access…</span>
        </li>
      </PrefsGroup>
    );
  }

  const description = (
    <>
      Reach KCG Code from anywhere at your own address. Requires a Google account and an app lock.
    </>
  );

  // ---- API tunnel belum diatur (KCG_TUNNEL_API_URL / build) ----
  if (!t.configured) {
    return (
      <PrefsGroup id="remote" title="Remote access" description={description}>
        <ActionRow
          prefix={<RowIcon />}
          title="Not configured"
          subtitle={
            <>
              This build has no tunnel server. Set{" "}
              <code className="font-mono text-[12px]">KCG_TUNNEL_API_URL</code> and restart kcgcode.
            </>
          }
        />
      </PrefsGroup>
    );
  }

  // ---- belum tersambung ----
  if (!t.account) {
    return (
      <PrefsGroup id="remote" title="Remote access" description={description}>
        {t.pairing ? (
          <PairingRow
            pairing={t.pairing}
            busy={busy !== null}
            onCancel={() => void act("cancel", "/api/tunnel/connect/cancel")}
          />
        ) : (
          <ActionRow
            prefix={<RowIcon />}
            title="Connect this machine"
            subtitle={
              t.error ? (
                <span className="text-destructive">{apiErrorMessage(t.error)}</span>
              ) : !protectedApp ? (
                <span className="text-amber-800 dark:text-amber-300">
                  Set an app lock above first.
                </span>
              ) : (
                "Sign in with Google on any device and claim your address"
              )
            }
            suffix={
              <Button
                type="button"
                size="sm"
                disabled={busy !== null || !protectedApp}
                onClick={() => void act("connect", "/api/tunnel/connect")}
              >
                {busy === "connect" && <Spinner data-icon="inline-start" />}
                Connect
              </Button>
            }
          />
        )}
      </PrefsGroup>
    );
  }

  // ---- tersambung ----
  const running = t.enabled && t.phase !== "stopped";
  const tone = t.phase === "online" ? "success" : t.phase === "error" ? "warning" : "muted";

  return (
    <>
      <PrefsGroup
        id="remote"
        title="Remote access"
        description={description}
        suffix={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showLog}
            onClick={() => setShowLog((v) => !v)}
          >
            <TerminalSquareIcon data-icon="inline-start" />
            {showLog ? "Hide log" : "Log"}
          </Button>
        }
      >
        <ActionRow
          prefix={<RowIcon online={t.phase === "online"} />}
          title="Tunnel"
          subtitle={
            !protectedApp ? (
              <span className="text-amber-800 dark:text-amber-300">
                Set an app lock above to turn this on.
              </span>
            ) : t.error ? (
              <span className="text-destructive">{apiErrorMessage(t.error)}</span>
            ) : running ? (
              "Your address is public. Visitors still need your PIN or password."
            ) : (
              "Off. Only this network can reach KCG Code."
            )
          }
          suffix={
            <>
              <RowBadge tone={tone}>{PHASE_LABEL[t.phase]}</RowBadge>
              {running ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void act("stop", "/api/tunnel/stop", "Remote access turned off.")}
                >
                  {busy === "stop" && <Spinner data-icon="inline-start" />}
                  Turn off
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy !== null || !protectedApp}
                  onClick={() => void act("start", "/api/tunnel/start")}
                >
                  {busy === "start" && <Spinner data-icon="inline-start" />}
                  Turn on
                </Button>
              )}
            </>
          }
        />
        <UrlRow url={t.account.url} />
        <ActionRow title="Account" subtitle={t.account.email} />
        {showLog && <LogPanel />}
      </PrefsGroup>

      <PrefsGroup>
        <ActionRow
          prefix={<RefreshCwIcon className="size-5 text-muted-foreground" aria-hidden />}
          title="Rotate tunnel secret"
          subtitle="Use this if you think the secret leaked. Other connected machines must reconnect."
          disabled={busy !== null}
          onActivate={() =>
            void act("rotate", "/api/tunnel/rotate-secret", "Tunnel secret rotated.")
          }
        />
        <ActionRow
          title="Disconnect this machine"
          subtitle="Turns the tunnel off and revokes this machine's access to your account"
          destructive
          disabled={busy !== null}
          onActivate={() => void act("signout", "/api/tunnel/signout", "Disconnected.")}
        />
      </PrefsGroup>
    </>
  );
}

function RowIcon({ online }: { online?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-9 items-center justify-center rounded-full",
        online
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      <GlobeIcon className="size-5" aria-hidden />
    </span>
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
    <li className="flex flex-col items-center gap-4 px-4 py-5 text-center sm:flex-row sm:items-start sm:text-left">
      <QrCode
        value={pairing.verificationUriComplete}
        label="QR code to open the sign-in page on your phone"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">
          Open this link on any device, sign in with Google, and approve this machine:
        </p>
        <a
          href={pairing.verificationUriComplete}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-[14px] font-medium underline underline-offset-2"
        >
          {pairing.verificationUri}
        </a>
        <p className="text-[13px] text-muted-foreground">Check that the page shows this code:</p>
        <p className="font-mono text-2xl font-semibold tracking-[0.15em]">
          <span className="sr-only">Code </span>
          {pairing.userCode}
        </p>
        <div className="flex items-center justify-center gap-3 sm:justify-start">
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground" role="status">
            <Spinner className="size-3.5" />
            Waiting for approval · {mm}:{ss}
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
function QrCode({ value, label }: { value: string; label: string }) {
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
      className="size-40 shrink-0 rounded-lg bg-white p-1"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

function UrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Address copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API butuh konteks aman (HTTPS / localhost).
      toast.error("Couldn't copy. Select the address and copy it manually.");
    }
  };
  return (
    <ActionRow
      title="Address"
      subtitle={<span className="break-all font-mono text-[12.5px]">{url}</span>}
      suffix={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={copied ? "Copied" : "Copy address"}
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-8">
            <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open address">
              <ExternalLinkIcon />
            </a>
          </Button>
        </>
      }
    />
  );
}

/** Log frpc live (polling bertahap `?from=`). */
function LogPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const next = useRef(0);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await apiFetch(`/api/tunnel/logs?from=${next.current}`);
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
  }, []);

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
        aria-label="Tunnel log"
        className="max-h-56 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all"
      >
        {lines.length === 0 ? "No output yet." : lines.join("\n")}
      </pre>
    </li>
  );
}
