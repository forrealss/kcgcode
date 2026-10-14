/** Penyedia bawaan saat komputer belum tertaut: langkah setup & pairing. */
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/hooks/useRouter";
import { apiErrorMessage } from "@/lib/api";
import { settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { TunnelStatus } from "@/server/services/tunnel";
import { QrCode } from "./QrCode";
import { StatusIcon } from "./rows";

export function SetupSteps({
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
export function PairingRow({
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
