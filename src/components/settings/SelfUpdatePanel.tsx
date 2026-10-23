/**
 * Kartu update di Settings -> About.
 *
 * - Bisa dipasang dari app (binary global Bun): tombol "Update now" ->
 *   progres per tahap output installer -> restart otomatis (mode
 *   background) lalu halaman reload sendiri, atau "restart kcgcode" (mode
 *   dashboard terminal).
 * - Session yang masih berjalan akan terhenti saat KCG Code restart:
 *   peringatan di kartu + konfirmasi sebelum mulai.
 * - Tidak bisa dipasang dari app (bun dev / npm / checkout git): perintah
 *   manual (`ManualUpdateCard`) seperti sebelumnya.
 *
 * Banner sidebar & dialog versi baru membuka halaman ini dan meminta update
 * dimulai (`requestUpdateStart`) — diproses di sini sekali status termuat.
 */
import {
  CircleAlertIcon,
  CircleArrowUpIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CopyIconButton } from "@/components/common/CopyIconButton";
import { LogView } from "@/components/common/LogView";
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
import { Spinner } from "@/components/ui/spinner";
import { useSelfUpdate } from "@/hooks/useSelfUpdate";
import { apiErrorMessage } from "@/lib/api";
import {
  consumeUpdateRequest,
  isUpdateActive,
  onUpdateRequest,
  updateStepLabel,
} from "@/lib/self-update";
import { pluralSessions } from "@/lib/session-selection";
import type { UpdateInfo } from "@/server/services/update-check";
import type { SelfUpdateStatus } from "@/types";

const CARD = "mt-6 w-full max-w-sm rounded-2xl border bg-background p-4 text-left";

export function SelfUpdatePanel({ update }: { update: UpdateInfo }) {
  const ctl = useSelfUpdate(update);
  const { status, start } = ctl;
  const [confirming, setConfirming] = useState(false);

  /** Mulai, atau minta konfirmasi dulu bila ada Session berjalan. */
  const requestStart = useCallback(() => {
    if (!status || status.unsupported || isUpdateActive(status)) return;
    if (status.phase === "restarting" || status.phase === "installed") return;
    if (status.runningSessions.length > 0) setConfirming(true);
    else void start();
  }, [status, start]);

  // Permintaan dari banner / dialog: diproses setelah status termuat.
  const loaded = status !== null;
  useEffect(() => {
    if (!loaded) return;
    if (consumeUpdateRequest()) requestStart();
    return onUpdateRequest(() => {
      if (consumeUpdateRequest()) requestStart();
    });
  }, [loaded, requestStart]);

  return (
    <>
      <SelfUpdateView
        update={update}
        status={status}
        logs={ctl.logs}
        starting={ctl.starting}
        waiting={ctl.waiting}
        onUpdate={requestStart}
      />
      <ConfirmUpdateDialog
        open={confirming}
        onOpenChange={setConfirming}
        status={status}
        version={update.latest}
        onConfirm={() => {
          setConfirming(false);
          void start();
        }}
      />
    </>
  );
}

export interface SelfUpdateViewProps {
  update: UpdateInfo;
  status: SelfUpdateStatus | null;
  logs: string[];
  starting: boolean;
  waiting: { slow: boolean } | null;
  onUpdate: () => void;
}

/** Tampilan murni per fase (diuji SSR). */
export function SelfUpdateView({
  update,
  status,
  logs,
  starting,
  waiting,
  onUpdate,
}: SelfUpdateViewProps) {
  // Belum dimuat / tidak bisa dipasang dari app -> perintah manual.
  if (!status || status.unsupported) return <ManualUpdateCard update={update} />;

  const version = status.target ?? update.latest;
  const auto = status.restart === "auto";

  if (waiting || status.phase === "restarting") {
    return (
      <section aria-labelledby="about-update" aria-live="polite" className={CARD}>
        <h3 id="about-update" className="flex items-center gap-2 text-[14px] font-medium">
          <Spinner className="size-4 shrink-0 text-[#6D5CFB]" />
          Restarting KCG Code…
        </h3>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          v{version} is installed. This page reloads by itself when KCG Code is back.
        </p>
        {waiting?.slow && (
          <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
            This is taking longer than usual. Check{" "}
            <code className="font-mono">kcgcode status</code> on your computer.
          </p>
        )}
      </section>
    );
  }

  if (isUpdateActive(status)) {
    return (
      <section aria-labelledby="about-update" className={CARD}>
        <h3 id="about-update" className="flex items-center gap-2 text-[14px] font-medium">
          <CircleArrowUpIcon className="size-4 shrink-0 text-[#6D5CFB]" aria-hidden />
          Updating to v{version}
        </h3>
        <div className="mt-3 flex items-baseline justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">{updateStepLabel(status.step, version)}</span>
          <span className="font-mono tabular-nums">{status.progress}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Update progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.progress}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-[#6D5CFB] transition-[width] duration-500"
            style={{ width: `${status.progress}%` }}
          />
        </div>
        {status.runningSessions.length > 0 && auto && (
          <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
            Running sessions will stop when KCG Code restarts.
          </p>
        )}
        <UpdateLog logs={logs} />
      </section>
    );
  }

  if (status.phase === "installed") {
    return (
      <section aria-labelledby="about-update" className={CARD}>
        <h3 id="about-update" className="flex items-center gap-2 text-[14px] font-medium">
          <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" aria-hidden />v{version} is
          installed
        </h3>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          Restart <code className="font-mono">kcgcode</code> on your computer to start using it.
        </p>
        <RunningSessionsWarning status={status} />
      </section>
    );
  }

  const failed = status.phase === "failed";
  return (
    <section aria-labelledby="about-update" className={CARD}>
      <h3 id="about-update" className="flex items-center gap-2 text-[14px] font-medium">
        <CircleArrowUpIcon className="size-4 shrink-0 text-[#6D5CFB]" aria-hidden />
        Update available: v{update.latest}
      </h3>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
        {auto
          ? "Install it now. KCG Code restarts by itself when it's done."
          : "Install it now, then restart kcgcode on your computer to use it."}
      </p>

      {failed && status.error && (
        <p role="alert" className="mt-3 flex gap-2 text-[13px] leading-snug text-destructive">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {apiErrorMessage(status.error)}
        </p>
      )}

      <RunningSessionsWarning status={status} />

      <Button type="button" className="mt-3 w-full" disabled={starting} onClick={onUpdate}>
        {starting && <Spinner data-icon="inline-start" />}
        {failed ? "Try again" : "Update now"}
      </Button>

      {failed && <UpdateLog logs={logs} />}

      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-muted-foreground select-none">
          Or update from the terminal
        </summary>
        <CommandRow command={update.command} />
      </details>
    </section>
  );
}

/** Session yang akan terhenti saat KCG Code restart. */
function RunningSessionsWarning({ status }: { status: SelfUpdateStatus }) {
  const n = status.runningSessions.length;
  if (n === 0) return null;
  const one = n === 1;
  const auto = status.restart === "auto";
  return (
    <div
      role="note"
      className="mt-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] leading-snug"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="font-medium">
          {pluralSessions(n)} {n === 1 ? "is" : "are"} still running
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {auto || status.phase === "installed"
            ? `Restarting KCG Code stops ${one ? "it" : "them"}.`
            : `${one ? "It stops" : "They stop"} when you restart kcgcode.`}{" "}
          You'll need to start {one ? "it" : "them"} again afterwards.
        </p>
      </div>
    </div>
  );
}

function UpdateLog({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;
  return (
    <details className="mt-3 text-[13px]">
      <summary className="cursor-pointer text-muted-foreground select-none">Details</summary>
      <LogView
        lines={logs}
        aria-label="Update output"
        className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted/70 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap"
      />
    </details>
  );
}

function CommandRow({ command }: { command: string }) {
  return (
    <div className="mt-3 flex items-center gap-1 rounded-lg bg-muted/70 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{command}</code>
      <CopyIconButton
        value={command}
        label="Copy command"
        className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
        iconClassName="size-4"
      />
    </div>
  );
}

/** Versi baru tersedia tapi dipasang manual: perintah install + tombol salin. */
export function ManualUpdateCard({ update }: { update: UpdateInfo }) {
  return (
    <section aria-labelledby="about-update" className={CARD}>
      <h3 id="about-update" className="flex items-center gap-2 text-[14px] font-medium">
        <CircleArrowUpIcon className="size-4 shrink-0 text-[#6D5CFB]" aria-hidden />
        Update available: v{update.latest}
      </h3>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
        Run this on the computer running KCG Code, then restart{" "}
        <code className="font-mono">kcgcode</code>.
      </p>
      <CommandRow command={update.command} />
    </section>
  );
}

function ConfirmUpdateDialog({
  open,
  onOpenChange,
  status,
  version,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: SelfUpdateStatus | null;
  version: string;
  onConfirm: () => void;
}) {
  const sessions = status?.runningSessions ?? [];
  const one = sessions.length === 1;
  const auto = status?.restart === "auto";
  const names = sessions
    .slice(0, 3)
    .map((s) => s.title || "Untitled session")
    .join(", ");
  const more = sessions.length > 3 ? ` and ${sessions.length - 3} more` : "";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Stop {sessions.length === 1 ? "the running session" : "running sessions"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pluralSessions(sessions.length)} {sessions.length === 1 ? "is" : "are"} still running (
            {names}
            {more}).{" "}
            {auto
              ? `Updating to v${version} restarts KCG Code, which stops ${one ? "it" : "them"}.`
              : `${one ? "It keeps" : "They keep"} running until you restart kcgcode to use v${version}.`}{" "}
            You'll need to start {one ? "it" : "them"} again afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Update anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
