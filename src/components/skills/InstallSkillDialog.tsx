/**
 * Dialog konfirmasi instalasi skill dari skills.sh.
 *
 * Menampilkan sumber, tautan ke halaman skill, dan hasil audit keamanan
 * (`GET /api/skills/audit`) SEBELUM user menekan Install — skill berjalan
 * dengan izin penuh agent, jadi keputusan dibuat dengan informasi lengkap.
 * Skill berstatus `fail` tetap boleh dipasang tapi tombolnya destruktif.
 *
 * Konfirmasi hanya MEMULAI job instalasi; dialog lalu ditutup dan progres +
 * output CLI tampil di notifikasi instalasi (`InstallNotifications`).
 */
import {
  ExternalLinkIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { AUDIT_BADGE_CLASS, AUDIT_LABEL, formatInstalls } from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type { RegistrySkill, SkillAudit } from "@/server/services/skills-registry";

type AuditState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; audit: SkillAudit };

export interface InstallSkillDialogProps {
  /** Skill yang akan dipasang; `null` = dialog tertutup. */
  skill: RegistrySkill | null;
  projectName: string;
  /** Permintaan memulai instalasi sedang dikirim. */
  starting: boolean;
  /** Pesan bila server menolak memulai (mis. instalasi lain sedang berjalan). */
  startError: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (skill: RegistrySkill) => void;
}

export function InstallSkillDialog({
  skill,
  projectName,
  starting,
  startError,
  onOpenChange,
  onConfirm,
}: InstallSkillDialogProps) {
  const [audit, setAudit] = useState<AuditState>({ phase: "loading" });

  useEffect(() => {
    if (!skill) return;
    let cancelled = false;
    setAudit({ phase: "loading" });
    const params = new URLSearchParams({ source: skill.source, skill: skill.skillId });
    apiFetch(`/api/skills/audit?${params}`)
      .then((res) => res.json() as Promise<{ audit: SkillAudit }>)
      .then(({ audit }) => {
        if (!cancelled) setAudit({ phase: "ready", audit });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAudit({
            phase: "error",
            message: e instanceof ApiError ? e.message : "Failed to load the security audit.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skill]);

  const flagged = audit.phase === "ready" && audit.audit.overall === "fail";

  return (
    <AlertDialog
      open={skill !== null}
      onOpenChange={(next) => {
        if (!starting) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">Install {skill?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The skill will be added to <span className="font-medium">{projectName}</span> under{" "}
            <code className="font-mono text-xs">.agents/skills/</code>. Skills run with the agent's
            full permissions, so review them before use.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {skill && (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="min-w-0 truncate font-mono text-xs leading-5">{skill.source}</dd>
              <dt className="text-muted-foreground">Installs</dt>
              <dd className="tabular-nums">{formatInstalls(skill.installs)}</dd>
            </dl>
            <a
              href={skill.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs font-medium underline underline-offset-4"
            >
              View on skills.sh
              <ExternalLinkIcon className="size-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>

            <section
              aria-label="Security audit"
              className="flex flex-col gap-2 rounded-xl border p-3"
            >
              <AuditSummary state={audit} />
            </section>

            <p className="text-xs text-muted-foreground">
              Installation runs in the background. You can follow the output in the notification.
            </p>
            {startError && (
              <p role="alert" className="text-xs text-destructive">
                {startError}
              </p>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={starting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={flagged ? "destructive" : "default"}
            disabled={starting || !skill}
            onClick={(e) => {
              // Dialog tetap terbuka selama instalasi berjalan.
              e.preventDefault();
              if (skill) onConfirm(skill);
            }}
          >
            {starting ? (
              <>
                <Spinner data-icon="inline-start" />
                Starting…
              </>
            ) : flagged ? (
              "Install anyway"
            ) : (
              "Install"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AuditSummary({ state }: { state: AuditState }) {
  if (state.phase === "loading") {
    return (
      <div role="status" className="flex flex-col gap-2" aria-busy="true">
        <span className="sr-only">Loading security audit…</span>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
  }
  if (state.phase === "error") {
    return <p className="text-xs text-muted-foreground">{state.message}</p>;
  }

  const { audits, overall } = state.audit;
  if (audits === null || overall === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldQuestionIcon className="size-4 shrink-0" aria-hidden />
        No security audit is available for this skill yet.
      </p>
    );
  }

  const Icon = overall === "pass" ? ShieldCheckIcon : ShieldAlertIcon;
  return (
    <>
      <p className="flex items-center gap-2 text-xs font-medium">
        <Icon className="size-4 shrink-0" aria-hidden />
        Security audit
        <span
          className={cn(
            "rounded px-1.5 text-[11px] leading-5 font-medium",
            AUDIT_BADGE_CLASS[overall],
          )}
        >
          {AUDIT_LABEL[overall]}
        </span>
      </p>
      <ul className="flex flex-col gap-1.5">
        {audits.map((a) => (
          <li key={a.provider} className="flex items-start justify-between gap-3 text-xs">
            <span className="min-w-0">
              <span className="font-medium">{a.provider}</span>
              {a.summary && (
                <span className="line-clamp-2 text-muted-foreground" title={a.summary}>
                  {a.summary}
                </span>
              )}
            </span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 text-[11px] leading-5 font-medium",
                AUDIT_BADGE_CLASS[a.status],
              )}
            >
              {AUDIT_LABEL[a.status]}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
