/**
 * Preview dev server Project: tombol di header Session + sheet kontrol.
 *
 * Tombol hanya ikon dunia dengan titik status (di layar lebar ditambah
 * `:port`), supaya header HP tidak bertambah sesak. Sheet (bawah di HP,
 * kanan di layar lebar) berisi status, Start/Stop/Restart, Open preview,
 * dan log dev server. Perintah ditampilkan sebelum Start — tekan Start itu
 * persetujuannya, karena config bisa ditulis agent.
 *
 * Tanpa config: tombol meminta agent di chat ini menyiapkannya. Server yang
 * dijalankan agent sendiri (diadopsi) ditandai; Stop hanya melepasnya.
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
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageLightbox } from "@/components/sessions/ImageLightbox";
import { Button } from "@/components/ui/button";
import {
  Sheet,
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
  const { server } = preview;
  const phase = server?.phase;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Preview: ${statusLabel(server)}`}
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
      <PreviewSheetContent
        side={mobile ? "bottom" : "right"}
        preview={preview}
        canAskAgent={canAskAgent}
        onAskAgent={(text) => {
          onAskAgent(text);
          setOpen(false);
        }}
      />
    </Sheet>
  );
}

function PreviewSheetContent({
  side,
  preview,
  onAskAgent,
  canAskAgent,
}: {
  side: "bottom" | "right";
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

  return (
    <SheetContent
      side={side}
      className={cn(
        "gap-0",
        side === "bottom" && "max-h-[85dvh] pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      <SheetHeader className="pb-2">
        <SheetTitle>Preview</SheetTitle>
        <SheetDescription>
          {config
            ? `Dev server from ${config.source} · ${config.name}`
            : "See the app you're building, from anywhere."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-2">
        {!loaded ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : !config && !active ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            <p>
              No dev server found. Add a <code className="font-mono">dev</code> script to{" "}
              <code className="font-mono">package.json</code>, or a{" "}
              <code className="font-mono">.claude/launch.json</code> to the project.
            </p>
            <Button
              variant="outline"
              onClick={() => onAskAgent(PREVIEW_SETUP_PROMPT)}
              disabled={!canAskAgent}
            >
              <BotIcon data-icon="inline-start" />
              Ask the agent to set it up
            </Button>
            {!canAskAgent && <p className="text-xs">Start the session to ask the agent.</p>}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm" role="status">
              <span
                className={cn("size-2 shrink-0 rounded-full", DOT[server?.phase ?? "stopped"])}
                aria-hidden
              />
              <span className="font-medium">{statusLabel(server)}</span>
            </div>

            <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs">
              <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{server?.command ?? config?.command}</span>
            </div>

            {external && (
              <p className="text-sm text-muted-foreground">
                The agent started this server. KCG Code shows it in the preview but doesn't control
                it.
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-col gap-2">
              {running &&
                (openUrl ? (
                  <Button asChild size="lg" className="w-full">
                    <a href={openUrl} target="_blank" rel="noopener" onClick={consumeOpenUrl}>
                      <ExternalLinkIcon data-icon="inline-start" />
                      Open preview
                    </a>
                  </Button>
                ) : error ? null : (
                  <Button size="lg" className="w-full" disabled>
                    <Spinner data-icon="inline-start" />
                    Open preview
                  </Button>
                ))}
              {running && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void snap.take()}
                  disabled={snap.busy}
                >
                  {snap.busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CameraIcon data-icon="inline-start" />
                  )}
                  Take a snapshot
                </Button>
              )}
              <div className="flex gap-2">
                {active ? (
                  <>
                    <Button
                      variant="outline"
                      className={cn("flex-1", external && !config && "hidden")}
                      onClick={() => void start()}
                      disabled={busy !== null || !config}
                    >
                      {busy === "start" ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <RotateCwIcon data-icon="inline-start" />
                      )}
                      {external ? "Run with KCG Code" : "Restart"}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => void stop()}
                      disabled={busy !== null}
                    >
                      {busy === "stop" ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <SquareIcon data-icon="inline-start" className="fill-current" />
                      )}
                      {external ? "Detach" : "Stop"}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => void start()}
                    disabled={busy !== null || !config}
                  >
                    {busy === "start" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <PlayIcon data-icon="inline-start" className="fill-current" />
                    )}
                    Start dev server
                  </Button>
                )}
              </div>
            </div>

            {snap.error && <p className="text-sm text-destructive">{snap.error}</p>}
            {snap.url && (
              <button
                type="button"
                onClick={() => snap.setLightbox(0)}
                className="shrink-0 overflow-hidden rounded-xl border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label="Open the snapshot"
              >
                <img
                  src={snap.url}
                  alt="Snapshot of the preview"
                  className="max-h-80 w-full object-cover object-top"
                />
              </button>
            )}
            {snap.url && (
              <ImageLightbox
                images={[{ src: snap.url, alt: "Snapshot of the preview" }]}
                index={snap.lightbox}
                onIndexChange={snap.setLightbox}
              />
            )}

            <LogView lines={logs} />
          </>
        )}
      </div>
    </SheetContent>
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

function LogView({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  // Ikuti baris terbaru.
  useEffect(() => {
    const el = ref.current;
    if (el && lines.length > 0) el.scrollTop = el.scrollHeight;
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <section aria-label="Dev server log" className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">Log</h3>
      <pre
        ref={ref}
        className="max-h-64 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
      >
        {lines.join("\n")}
      </pre>
    </section>
  );
}
