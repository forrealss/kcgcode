/**
 * Dialog konfirmasi instalasi skill dari skills.sh.
 *
 * Susunan (atas -> bawah), dari yang paling sering diputuskan:
 * 1. Identitas skill: avatar owner, nama, `source · installs · skills.sh ↗`.
 * 2. Agent tujuan: dua tile berdampingan (OpenCode / Claude Code, bisa
 *    keduanya). Agent yang belum memuat skill ini terpilih secara default;
 *    yang sudah memuatnya ditandai "Installed" (memilihnya = pasang ulang).
 * 3. Audit keamanan (`GET /api/skills/audit`) dalam satu baris ringkas;
 *    rincian per partner dilipat dan otomatis terbuka bila ada temuan
 *    (`warn`/`fail`). Skill `fail` tetap boleh dipasang, tombolnya destruktif.
 *
 * Label tombol menyebut agent tujuan ("Install for Claude Code"). Konfirmasi
 * hanya MEMULAI job instalasi; progres + output CLI tampil di notifikasi
 * instalasi (`InstallNotifications`).
 */
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { SourceAvatar } from "@/components/skills/SkillCards";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_TYPE_LABELS, AGENT_TYPES } from "@/lib/agent-types";
import { ApiError, apiFetch } from "@/lib/api";
import { AUDIT_BADGE_CLASS, AUDIT_LABEL, formatInstalls } from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type { RegistrySkill, SkillAudit } from "@/server/services/skills-registry";
import type { AgentType } from "@/types";

type AuditState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; audit: SkillAudit };

export interface InstallSkillDialogProps {
  /** Skill yang akan dipasang; `null` = dialog tertutup. */
  skill: RegistrySkill | null;
  projectName: string;
  /** Agent yang sudah memuat skill ini dari folder Project. */
  installedAgents: readonly AgentType[];
  /** Permintaan memulai instalasi sedang dikirim. */
  starting: boolean;
  /** Pesan bila server menolak memulai (mis. instalasi lain sedang berjalan). */
  startError: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (skill: RegistrySkill, agents: AgentType[]) => void;
}

/** Folder skill di Project per agent (petunjuk di tile). */
const AGENT_SKILLS_DIR: Record<AgentType, string> = {
  opencode: ".agents/skills",
  "claude-code": ".claude/skills",
};

/** Label tombol utama sesuai agent terpilih. */
function installLabel(agents: readonly AgentType[], flagged: boolean): string {
  const verb = flagged ? "Install anyway" : "Install";
  if (agents.length === 0) return verb;
  if (agents.length === AGENT_TYPES.length) return `${verb} for both`;
  return `${verb} for ${agents.map((a) => AGENT_TYPE_LABELS[a]).join(" + ")}`;
}

export function InstallSkillDialog({
  skill,
  projectName,
  installedAgents,
  starting,
  startError,
  onOpenChange,
  onConfirm,
}: InstallSkillDialogProps) {
  const [audit, setAudit] = useState<AuditState>({ phase: "loading" });
  const [agents, setAgents] = useState<AgentType[]>([]);

  // Dialog dibuka untuk skill baru -> pilih agent yang belum memuatnya.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya saat skill berganti
  useEffect(() => {
    if (!skill) return;
    const missing = AGENT_TYPES.filter((a) => !installedAgents.includes(a));
    setAgents(missing.length > 0 ? missing : [...AGENT_TYPES]);
  }, [skill]);

  const toggleAgent = (agent: AgentType, on: boolean) =>
    setAgents((prev) => AGENT_TYPES.filter((a) => (a === agent ? on : prev.includes(a))));

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
      {/* Tinggi dibatasi agar dialog (audit terbuka) tetap muat di layar HP. */}
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md">
        <AlertDialogHeader className="text-left">
          <div className="flex min-w-0 items-center gap-3">
            {skill && <SourceAvatar source={skill.source} />}
            <div className="flex min-w-0 flex-col gap-0.5">
              <AlertDialogTitle className="truncate" title={skill?.name}>
                Install {skill?.name}
              </AlertDialogTitle>
              {skill && (
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate font-mono" title={skill.source}>
                    {skill.source}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 tabular-nums">
                    {formatInstalls(skill.installs)} installs
                  </span>
                  <span aria-hidden>·</span>
                  <a
                    href={skill.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    skills.sh
                    <ExternalLinkIcon className="size-3" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </p>
              )}
            </div>
          </div>
          <AlertDialogDescription className="sr-only">
            Choose which agents in {projectName} get this skill, then review its security audit.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {skill && (
          <div className="flex min-w-0 flex-col gap-4 text-sm">
            <fieldset className="flex flex-col gap-2" disabled={starting}>
              <legend className="mb-2 text-xs text-muted-foreground">
                Add to <span className="font-medium text-foreground">{projectName}</span> for
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {AGENT_TYPES.map((a) => (
                  <AgentTile
                    key={a}
                    agent={a}
                    checked={agents.includes(a)}
                    installed={installedAgents.includes(a)}
                    onChange={(on) => toggleAgent(a, on)}
                  />
                ))}
              </div>
              {agents.length === 0 && (
                <p className="text-xs text-muted-foreground">Pick at least one agent.</p>
              )}
            </fieldset>

            <AuditPanel state={audit} />

            {startError && (
              <p role="alert" className="text-xs text-destructive">
                {startError}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Skills run with the agent's full permissions. Installation continues in the background —
            follow it in the notification.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={starting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={flagged ? "destructive" : "default"}
              disabled={starting || !skill || agents.length === 0}
              onClick={(e) => {
                // Dialog tetap terbuka sampai job berhasil dibuat.
                e.preventDefault();
                if (skill && agents.length > 0) onConfirm(skill, agents);
              }}
            >
              {starting ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Starting…
                </>
              ) : (
                installLabel(agents, flagged)
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Tile agent yang bisa dipilih: logo, nama, folder tujuan, indikator centang
 * di pojok. Checkbox asli disembunyikan (`sr-only`) tapi tetap jadi kontrol
 * yang dibaca screen reader & menerima fokus keyboard (Spasi).
 */
function AgentTile({
  agent,
  checked,
  installed,
  onChange,
}: {
  agent: AgentType;
  checked: boolean;
  installed: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer flex-col gap-2.5 rounded-xl border p-3 transition-colors select-none",
        "has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60",
        checked ? "border-primary bg-primary/5" : "hover:border-foreground/20 hover:bg-accent/30",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="flex items-start justify-between">
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">
          <AgentLogo agentType={agent} className="size-4" />
        </span>
        <span
          aria-hidden
          className={cn(
            "flex size-5 items-center justify-center rounded-full border transition-colors",
            checked ? "border-primary bg-primary text-primary-foreground" : "bg-background",
          )}
        >
          {checked && <CheckIcon className="size-3" strokeWidth={3} />}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium leading-5">{AGENT_TYPE_LABELS[agent]}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {installed ? (checked ? "Installed · reinstall" : "Installed") : AGENT_SKILLS_DIR[agent]}
        </span>
      </span>
    </label>
  );
}

/**
 * Audit keamanan sebagai satu baris ringkas (ikon, status, jumlah partner
 * yang lolos). Rincian per partner bisa dibuka; terbuka otomatis bila ada
 * temuan agar tidak terlewat.
 */
function AuditPanel({ state }: { state: AuditState }) {
  const shell = "rounded-xl border bg-muted/30";

  if (state.phase === "loading") {
    return (
      <div role="status" aria-busy="true" className={cn(shell, "flex items-center gap-3 p-3")}>
        <span className="sr-only">Loading security audit…</span>
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <p className={cn(shell, "flex items-center gap-2 p-3 text-xs text-muted-foreground")}>
        <ShieldQuestionIcon className="size-4 shrink-0" aria-hidden />
        {state.message}
      </p>
    );
  }

  const { audits, overall } = state.audit;
  if (audits === null || overall === null) {
    return (
      <p className={cn(shell, "flex items-start gap-2 p-3 text-xs text-muted-foreground")}>
        <ShieldQuestionIcon className="size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Not audited yet.</span> Review the skill on
          skills.sh before installing.
        </span>
      </p>
    );
  }

  const passed = audits.filter((a) => a.status === "pass").length;
  const Icon = overall === "pass" ? ShieldCheckIcon : ShieldAlertIcon;
  return (
    <Collapsible defaultOpen={overall !== "pass"} className={shell}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl p-3 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <Icon
          className={cn(
            "size-4 shrink-0",
            overall === "pass"
              ? "text-emerald-600 dark:text-emerald-400"
              : overall === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : "text-destructive",
          )}
          aria-hidden
        />
        <span className="font-medium">Security audit</span>
        <span
          className={cn(
            "rounded px-1.5 text-[11px] leading-5 font-medium",
            AUDIT_BADGE_CLASS[overall],
          )}
        >
          {AUDIT_LABEL[overall]}
        </span>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {passed}/{audits.length} passed
        </span>
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-2 border-t px-3 py-3">
          {audits.map((a) => (
            <li key={a.provider} className="flex items-start justify-between gap-3 text-xs">
              <span className="flex min-w-0 flex-col">
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
      </CollapsibleContent>
    </Collapsible>
  );
}
