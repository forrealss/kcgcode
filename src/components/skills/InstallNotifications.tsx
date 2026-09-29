/**
 * Notifikasi instalasi skill — tumpukan kartu di pojok kanan bawah (lebar
 * penuh di HP), dipasang sekali di `AppShell` sehingga tetap tampil di
 * halaman mana pun.
 *
 * Tiap kartu: status (spinner / centang / silang), nama skill -> Project,
 * waktu berjalan, dan panel output CLI (gaya terminal) yang bisa dibuka-
 * tutup dan otomatis menggulir ke baris terbaru — kecuali user sedang
 * menggulir ke atas membaca log.
 *
 * Aksesibilitas: wadah `role="region"`; perubahan status diumumkan lewat
 * satu `aria-live` ringkas (bukan tiap baris log, agar tidak berisik).
 */
import {
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  SquareIcon,
  TerminalIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { apiErrorMessage } from "@/lib/api";
import {
  cancelInstall,
  dismissInstall,
  hydrateInstalls,
  type InstallEntry,
  toggleInstallLog,
  useInstalls,
} from "@/lib/skill-installs";
import { cn } from "@/lib/utils";

/** Kartu yang tampil bersamaan; sisanya diringkas "+N more". */
const MAX_VISIBLE = 3;

export function InstallNotifications() {
  const all = useInstalls();

  useEffect(() => {
    void hydrateInstalls();
  }, []);

  const visible = all.filter((e) => !e.dismissed);
  const shown = visible.slice(0, MAX_VISIBLE);
  const hidden = visible.length - shown.length;
  const running = all.filter((e) => e.job.status === "running").length;

  return (
    <>
      {/* Pengumuman ringkas untuk pembaca layar. */}
      <p className="sr-only" aria-live="polite">
        {running > 0 ? `${running} skill installation${running > 1 ? "s" : ""} in progress.` : ""}
      </p>
      {shown.length > 0 && (
        <section
          aria-label="Skill installations"
          className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col-reverse gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem]"
        >
          {shown.map((entry) => (
            <InstallCard key={entry.job.id} entry={entry} />
          ))}
          {hidden > 0 && (
            <p className="pointer-events-auto self-end rounded-full border bg-popover px-3 py-1 text-xs text-muted-foreground shadow-md">
              +{hidden} more
            </p>
          )}
        </section>
      )}
    </>
  );
}

/** Detik berjalan (di-tick tiap detik selama job belum selesai). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function formatSeconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Diam selama ini -> tampilkan petunjuk "belum ada output". */
const QUIET_HINT_MS = 15_000;

function InstallCard({ entry }: { entry: InstallEntry }) {
  const { job, lines, expanded, pollError, truncated, cancelling } = entry;
  const running = job.status === "running";
  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";
  const now = useNow(running);
  const elapsed = formatSeconds((job.finishedAt ?? now) - job.startedAt);
  const quietMs = running ? now - job.lastOutputAt : 0;
  const logId = `install-log-${job.id}`;

  const title = running
    ? cancelling
      ? `Cancelling ${job.skillId}…`
      : `Installing ${job.skillId}`
    : cancelled
      ? `Cancelled ${job.skillId}`
      : failed
        ? `Couldn't install ${job.skillId}`
        : `Installed ${job.skillId}`;

  /** Terpasang di disk, tapi agent belum memuat ulang skill (chat berjalan). */
  const awaitingActivation = job.status === "succeeded" && job.refreshed === false;

  const subtitle = cancelled
    ? `Nothing was added to ${job.projectName}.`
    : failed
      ? apiErrorMessage(job.error ?? "SKILL_INSTALL_FAILED")
      : awaitingActivation
        ? `Added to ${job.projectName}. Activates automatically when the running chat finishes.`
        : `${running ? "into" : "Added to"} ${job.projectName}${
            job.status === "succeeded" ? " · active" : ""
          }`;

  return (
    <article
      aria-label={title}
      className={cn(
        "pointer-events-auto overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg",
        "animate-in fade-in-0 slide-in-from-bottom-2",
        failed && "border-destructive/40",
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden>
          {running ? (
            <Spinner className="size-4 text-primary" />
          ) : cancelled ? (
            <BanIcon className="size-5 text-muted-foreground" />
          ) : failed ? (
            <XCircleIcon className="size-5 text-destructive" />
          ) : awaitingActivation ? (
            <ClockIcon className="size-5 text-amber-600 dark:text-amber-400" />
          ) : (
            <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{elapsed}</span>
          </p>
          <p
            className={cn(
              "line-clamp-2 text-xs",
              failed ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {subtitle}
          </p>
          {awaitingActivation && (
            <span className="mt-0.5 flex w-fit items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
              Waiting for chat to finish
            </span>
          )}
          {pollError && <p className="text-xs text-amber-600 dark:text-amber-400">{pollError}</p>}
          {running && !cancelling && quietMs >= QUIET_HINT_MS && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No output for {formatSeconds(quietMs)} — still downloading, or you can cancel.
            </p>
          )}
          <span className="truncate font-mono text-[11px] text-muted-foreground/80">
            {job.source}
          </span>
        </div>
        <div className="-mt-0.5 -mr-1 flex shrink-0 items-center gap-0.5">
          {running && (
            <button
              type="button"
              onClick={() => void cancelInstall(job.id)}
              disabled={cancelling}
              aria-label={`Cancel installing ${job.skillId}`}
              title="Cancel installation"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <SquareIcon className="size-3 fill-current" aria-hidden />
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissInstall(job.id)}
            aria-label={running ? "Hide (installation continues)" : "Dismiss"}
            title={running ? "Hide — installation continues in the background" : "Dismiss"}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Indeterminate progress selama berjalan. */}
      {running && (
        <div className="h-0.5 w-full overflow-hidden bg-muted" aria-hidden>
          <div className="h-full w-1/3 animate-[install-progress_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      )}

      <div className="border-t">
        <button
          type="button"
          onClick={() => toggleInstallLog(job.id)}
          aria-expanded={expanded}
          aria-controls={logId}
          className="flex w-full items-center gap-2 px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <TerminalIcon className="size-3.5" aria-hidden />
          {expanded ? "Hide output" : "Show output"}
          <span className="tabular-nums text-muted-foreground/70">
            {lines.length > 0 && `· ${lines.length} lines`}
          </span>
          <ChevronDownIcon
            className={cn("ml-auto size-3.5 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </button>
        {expanded && <LogPanel id={logId} lines={lines} running={running} truncated={truncated} />}
      </div>
    </article>
  );
}

function LogPanel({
  id,
  lines,
  running,
  truncated,
}: {
  id: string;
  lines: string[];
  running: boolean;
  truncated: boolean;
}) {
  const ref = useRef<HTMLPreElement>(null);
  /** Ikuti baris terbaru selama user tidak menggulir ke atas. */
  const stick = useRef(true);
  const [copied, setCopied] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: gulir tiap ada baris baru
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard tidak tersedia (HTTP non-localhost) — abaikan.
    }
  };

  return (
    <div className="relative">
      {/* role="log": wilayah output berurutan; fokusable agar bisa digulir
          dengan keyboard. Tidak `aria-live` — pembaruan status diumumkan
          terpisah supaya pembaca layar tidak membacakan tiap baris. */}
      <pre
        ref={ref}
        id={id}
        role="log"
        aria-live="off"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: area gulir harus bisa difokus keyboard
        tabIndex={0}
        aria-label="Installation output"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-56 overflow-auto bg-zinc-950 px-3.5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-zinc-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {truncated && <span className="text-zinc-500">… earlier output trimmed{"\n"}</span>}
        {lines.length === 0 ? (
          <span className="text-zinc-500">Waiting for output…</span>
        ) : (
          lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log append-only
            <span key={i} className={lineClass(line)}>
              {line}
              {"\n"}
            </span>
          ))
        )}
        {running && <span className="animate-pulse text-zinc-400">▍</span>}
      </pre>
      {lines.length > 0 && (
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy output"
          className="absolute top-2 right-2 flex h-6 items-center gap-1 rounded-md bg-zinc-800/90 px-2 text-[11px] text-zinc-300 hover:bg-zinc-700"
        >
          <CopyIcon className="size-3" aria-hidden />
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

/** Warna baris log: perintah, sukses, gagal. */
function lineClass(line: string): string | undefined {
  if (line.startsWith("$ ")) return "text-sky-300";
  if (line.startsWith("✓")) return "text-emerald-400";
  if (line.startsWith("✗") || /^(error|■)/i.test(line.trimStart())) return "text-red-400";
  return undefined;
}
