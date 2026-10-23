/**
 * Preview dev server Project: tombol di header Session + side sheet kontrol.
 *
 * Tombol hanya ikon dunia dengan titik status (di layar lebar ditambah
 * `:port`), supaya header HP tidak bertambah sesak. Sheet muncul dari kanan
 * (desktop) atau dari bawah (HP), dan memakai primitif kartu konteks Session
 * (`Section` / `Box` / `Row`) agar proporsinya sama dengan panel detail
 * Session. Isinya:
 * - **Dev server**: baris status (Restart/Stop sebagai tombol bundar kecil),
 *   baris perintah, lalu aksi utama di baris terakhir:
 *   - Server hidup -> Open preview + Snapshot.
 *   - Server mati  -> Start. Perintah ditampilkan sebelum Start — tekan Start
 *     itu persetujuannya, karena config bisa ditulis agent.
 *   - Tanpa config -> minta agent di chat ini menyiapkannya.
 * - **Snapshot**: hasil snapshot terakhir (ketuk -> lightbox).
 * - **Output**: log dev server, mengikuti baris terbaru.
 * Server yang dijalankan agent sendiri (diadopsi) ditandai; Stop hanya
 * melepasnya.
 */
import {
  BotIcon,
  CameraIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { LogView } from "@/components/common/LogView";
import { Box, CardSkeleton, Row, Section } from "@/components/sessions/ContextPanel/primitives";
import { ImageLightbox } from "@/components/sessions/ImageLightbox";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { usePreview } from "@/hooks/usePreview";
import { errorText } from "@/lib/api";
import { type DevServerStatus, isActive, takePreviewSnapshot } from "@/lib/preview-api";
import { cn } from "@/lib/utils";

const DOT: Record<DevServerStatus["phase"], string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  crashed: "bg-destructive",
  exited: "bg-muted-foreground/50",
  stopped: "bg-muted-foreground/50",
};

function statusLabel(s: DevServerStatus | null): string {
  if (!s) return "Not running";
  switch (s.phase) {
    case "running":
      return `Running on :${s.port}`;
    case "starting":
      return "Starting…";
    case "crashed":
      return `Crashed (exit ${s.exitCode ?? "?"})`;
    case "exited":
      return "Exited";
    case "stopped":
      return "Stopped";
  }
}

/** Pesan ke agent saat Project belum punya config dev server. */
export const PREVIEW_SETUP_PROMPT =
  "Set up this project for KCG Code's preview: create .claude/launch.json with the command that runs the dev server (runtimeExecutable, runtimeArgs) and the port it listens on, like " +
  '{"version":"0.0.1","configurations":[{"name":"web","runtimeExecutable":"bun","runtimeArgs":["run","dev"],"port":5173}]}. ' +
  "Make sure the dev server listens on that port (or reads PORT from the environment). Don't start it yourself; I'll start it from KCG Code.";

/** Tombol aksi di baris terakhir `Box` (proporsi tombol compact kartu konteks). */
const ACTION = "h-8 flex-1 rounded-lg text-[12.5px] max-sm:h-10 max-sm:text-[13.5px]";
/** Tombol bundar kecil di kanan baris status. */
const CIRCULAR =
  "size-7 rounded-full text-muted-foreground max-sm:size-9 hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5";

export function PreviewButton({
  projectId,
  sessionId,
  onAskAgent,
  canAskAgent,
}: {
  projectId: string;
  /** Chat yang dihubungkan ke overlay di halaman preview. */
  sessionId: string;
  /** Kirim pesan ke agent di chat ini. */
  onAskAgent: (text: string) => void;
  canAskAgent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mobile = useMediaQuery(MOBILE_QUERY);
  const preview = usePreview(projectId, sessionId, open);
  const { server, config } = preview;
  const phase = server?.phase;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Preview: ${statusLabel(server)}`}
        aria-expanded={open}
        className="relative h-10 shrink-0 gap-1.5 px-2.5 sm:h-9"
      >
        <span className="relative" aria-hidden>
          <GlobeIcon className="size-[18px]" />
          {phase && phase !== "stopped" && (
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background",
                DOT[phase],
                phase === "starting" && "animate-pulse motion-reduce:animate-none",
              )}
            />
          )}
        </span>
        {phase === "running" && (
          <span className="hidden font-mono text-xs sm:inline">:{server?.port}</span>
        )}
      </Button>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        showCloseButton={false}
        className={cn(
          "gap-0",
          mobile
            ? "max-h-[85dvh] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            : "w-[22rem] sm:max-w-[22rem]",
        )}
      >
        <SheetHeader className="flex-row items-center gap-2.5 px-4 pt-3.5 pb-3 max-sm:pt-2">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4"
          >
            <GlobeIcon />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <SheetTitle className="truncate text-[15px] leading-5">Preview</SheetTitle>
            <SheetDescription className="truncate text-xs leading-4">
              {config ? `${config.name} · ${config.source}` : "Dev server"}
            </SheetDescription>
          </div>
          {!mobile && (
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close preview"
                title="Close (Esc)"
                className="size-7 shrink-0 rounded-full [&_svg]:size-3.5"
              >
                <XIcon />
              </Button>
            </SheetClose>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 [scrollbar-width:thin]">
          <PreviewSections
            preview={preview}
            canAskAgent={canAskAgent}
            onAskAgent={(text) => {
              onAskAgent(text);
              setOpen(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Baris aksi di dasar `Box` (tombol selebar baris). */
function ActionsRow({ children }: { children: ReactNode }) {
  return <li className="flex gap-1.5 px-2.5 py-2">{children}</li>;
}

function StatusDot({ phase }: { phase: DevServerStatus["phase"] | undefined }) {
  return (
    <span
      className={cn(
        "size-2 rounded-full",
        DOT[phase ?? "stopped"],
        phase === "starting" && "animate-pulse motion-reduce:animate-none",
      )}
    />
  );
}

function Notice({ tone, children }: { tone?: "error"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "px-1 text-[11.5px] leading-snug",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

function PreviewSections({
  preview,
  onAskAgent,
  canAskAgent,
}: {
  preview: ReturnType<typeof usePreview>;
  onAskAgent: (text: string) => void;
  canAskAgent: boolean;
}) {
  const { loaded, config, server, logs, openUrl, consumeOpenUrl, error, busy, start, stop } =
    preview;
  const active = isActive(server?.phase);
  const running = server?.phase === "running";
  const external = server?.external === true;
  const snap = useSnapshot(preview.projectId);
  const command = server?.command ?? config?.command ?? "";

  if (!loaded) return <CardSkeleton />;

  // Belum ada config: arahkan ke agent.
  if (!config && !active) {
    return (
      <div className="flex flex-col gap-4">
        <Section title="Dev server" summary="Not configured">
          <Box>
            <Row
              icon={<TerminalIcon />}
              label="No dev server found"
              hint="Add a dev script or .claude/launch.json"
              muted
            />
            <ActionsRow>
              <Button
                type="button"
                className={ACTION}
                onClick={() => onAskAgent(PREVIEW_SETUP_PROMPT)}
                disabled={!canAskAgent}
              >
                <BotIcon data-icon="inline-start" />
                Ask the agent to set it up
              </Button>
            </ActionsRow>
          </Box>
          {!canAskAgent && <Notice>Start the session to ask the agent.</Notice>}
        </Section>
      </div>
    );
  }

  const commandRow = command && (
    <Row icon={<TerminalIcon />} label={command} title={command} mono muted />
  );

  // Server mati / crash: tampilkan perintah sebelum Start.
  if (!active) {
    const crashed = server?.phase === "crashed";
    return (
      <div className="flex flex-col gap-4">
        <Section title="Dev server" summary={crashed ? "Crashed" : "Stopped"}>
          <div className="flex flex-col gap-1.5">
            <Box>
              <Row icon={<StatusDot phase={server?.phase} />} label={statusLabel(server)} />
              {commandRow}
              <ActionsRow>
                <Button
                  type="button"
                  className={ACTION}
                  onClick={() => void start()}
                  disabled={busy !== null}
                >
                  {busy === "start" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <PlayIcon data-icon="inline-start" className="fill-current" />
                  )}
                  {crashed ? "Restart dev server" : "Start dev server"}
                </Button>
              </ActionsRow>
            </Box>
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        </Section>
        {logs.length > 0 && <OutputSection lines={logs} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Dev server" summary={running ? `:${server?.port}` : "Starting…"}>
        <div className="flex flex-col gap-1.5">
          <Box>
            <Row
              icon={<StatusDot phase={server?.phase} />}
              label={statusLabel(server)}
              hint={external ? "Started by the agent" : undefined}
              value={
                <span className="-me-1 flex items-center">
                  {(!external || config) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={CIRCULAR}
                      onClick={() => void start()}
                      disabled={busy !== null || !config}
                      aria-label={external ? "Run with KCG Code" : "Restart"}
                      title={external ? "Run with KCG Code" : "Restart"}
                    >
                      {busy === "start" ? <Spinner /> : <RotateCwIcon />}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(CIRCULAR, "hover:text-destructive")}
                    onClick={() => void stop()}
                    disabled={busy !== null}
                    aria-label={external ? "Detach" : "Stop"}
                    title={external ? "Detach" : "Stop"}
                  >
                    {busy === "stop" ? <Spinner /> : <SquareIcon className="size-3 fill-current" />}
                  </Button>
                </span>
              }
            />
            {commandRow}
            <ActionsRow>
              {running && openUrl ? (
                <Button asChild className={ACTION}>
                  <a href={openUrl} target="_blank" rel="noopener" onClick={consumeOpenUrl}>
                    <ExternalLinkIcon data-icon="inline-start" />
                    Open preview
                  </a>
                </Button>
              ) : running && error ? null : (
                <Button type="button" className={ACTION} disabled>
                  <Spinner data-icon="inline-start" />
                  {running ? "Open preview" : "Starting…"}
                </Button>
              )}
              {running && (
                <Button
                  type="button"
                  variant="outline"
                  className={ACTION}
                  onClick={() => void snap.take()}
                  disabled={snap.busy}
                >
                  {snap.busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CameraIcon data-icon="inline-start" />
                  )}
                  Snapshot
                </Button>
              )}
            </ActionsRow>
          </Box>
          {external && (
            <Notice>
              KCG Code shows this server in the preview but doesn't control it. Stop only detaches.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {snap.error && <Notice tone="error">{snap.error}</Notice>}
        </div>
      </Section>

      {snap.url && (
        <Section title="Snapshot">
          <button
            type="button"
            onClick={() => snap.setLightbox(0)}
            className="block w-full overflow-hidden rounded-xl border bg-card shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label="Open the snapshot"
          >
            <img
              src={snap.url}
              alt="Snapshot of the preview"
              className="max-h-64 w-full object-cover object-top"
            />
          </button>
          <ImageLightbox
            images={[{ src: snap.url, alt: "Snapshot of the preview" }]}
            index={snap.lightbox}
            onIndexChange={snap.setLightbox}
          />
        </Section>
      )}

      <OutputSection lines={logs} />
    </div>
  );
}

/** Log dev server dalam kartu; ringkasan jumlah baris di judul. */
function OutputSection({ lines }: { lines: string[] }) {
  return (
    <Section
      title="Output"
      summary={
        lines.length > 0 ? `${lines.length} ${lines.length === 1 ? "line" : "lines"}` : undefined
      }
    >
      {lines.length > 0 ? (
        <LogView
          lines={lines}
          className="max-h-[22rem] overflow-auto rounded-xl border bg-card px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-foreground/85 shadow-xs [scrollbar-width:thin]"
        />
      ) : (
        <p className="rounded-xl border border-dashed px-2.5 py-2.5 text-[12px] text-muted-foreground">
          No output yet
        </p>
      )}
    </Section>
  );
}

/** Snapshot manual dari sheet (juga jalan keluar lewat localhost.run). */
function useSnapshot(projectId: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `projectId` sengaja jadi trigger reset
  useEffect(() => {
    setUrl(null);
    setError(null);
  }, [projectId]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function take(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const blob = await takePreviewSnapshot(projectId);
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(errorText(e, "Couldn't take a snapshot"));
    } finally {
      setBusy(false);
    }
  }
  return { url, busy, error, take, lightbox, setLightbox };
}
