/**
 * Dialog konfirmasi instalasi skill dari skills.sh.
 *
 * Gaya AdwAlertDialog + boxed list (libadwaita), atas -> bawah:
 * 1. Identitas skill: avatar owner, nama, `source · installs · skills.sh ↗`.
 * 2. "Install for": satu baris per agent (logo, nama, folder tujuan, kotak
 *    centang ala GtkCheckButton). Agent yang belum memuat skill ini terpilih
 *    secara default; yang sudah memuatnya bersubjudul "Installed"
 *    (memilihnya = pasang ulang).
 * 3. Audit keamanan (`GET /api/skills/audit`) sebagai satu AdwExpanderRow:
 *    subjudulnya sudah menyebut siapa yang menandai ("Flagged by Runlayer ·
 *    3 of 5 passed"), rincian per partner dilipat. Skill `fail` tetap boleh
 *    dipasang, tombolnya destruktif ("Install Anyway").
 *
 * Konfirmasi hanya MEMULAI job instalasi; progres + output CLI tampil di
 * notifikasi instalasi (`InstallNotifications`).
 */
import {
  CheckIcon,
  ExternalLinkIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { ActionRow, ExpanderRow } from "@/components/settings/prefs";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/hooks/useApiQuery";
import { AGENT_TYPE_LABELS, AGENT_TYPES } from "@/lib/agent-types";
import type { IdleLoad } from "@/lib/load-state";
import {
  AUDIT_LABEL,
  AUDIT_TEXT_CLASS,
  formatInstalls,
  summarizeAudit,
} from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type { RegistrySkill, SkillAudit } from "@/server/services/skills-registry";
import type { AgentType } from "@/types";

const selectAudit = async (res: Response) => ((await res.json()) as { audit: SkillAudit }).audit;

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

/** Boxed list ala libadwaita di dalam dialog. */
const BOXED = "flex flex-col divide-y overflow-hidden rounded-xl border bg-card";

export function InstallSkillDialog({
  skill,
  projectName,
  installedAgents,
  starting,
  startError,
  onOpenChange,
  onConfirm,
}: InstallSkillDialogProps) {
  const [audit] = useApiQuery(
    skill
      ? `/api/skills/audit?${new URLSearchParams({ source: skill.source, skill: skill.skillId })}`
      : null,
    { select: selectAudit, errorMessage: "Failed to load the security audit." },
  );
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

  const flagged = audit.phase === "ready" && audit.data.overall === "fail";

  return (
    <AlertDialog
      open={skill !== null}
      onOpenChange={(next) => {
        if (!starting) onOpenChange(next);
      }}
    >
      {/* Tinggi dibatasi agar dialog (audit terbuka) tetap muat di layar HP. */}
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto sm:max-w-md">
        <AlertDialogHeader className="text-left">
          <div className="flex min-w-0 items-center gap-3">
            {skill && <SourceAvatar source={skill.source} />}
            <div className="flex min-w-0 flex-col gap-0.5">
              <AlertDialogTitle className="truncate" title={skill?.name}>
                Install {skill?.name}
              </AlertDialogTitle>
              {skill && (
                <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                  <span className="truncate" title={skill.source}>
                    {skill.source}
                  </span>
                  <span className="opacity-50" aria-hidden>
                    ·
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatInstalls(skill.installs)} installs
                  </span>
                  <span className="opacity-50" aria-hidden>
                    ·
                  </span>
                  <a
                    href={skill.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on skills.sh (opens in a new tab)"
                    className="inline-flex shrink-0 items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    <ExternalLinkIcon className="size-3.5" aria-hidden />
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
          <div className="flex min-w-0 flex-col gap-5">
            <fieldset className="flex min-w-0 flex-col gap-2" disabled={starting}>
              <legend className="mb-2 px-1 text-[13px] text-muted-foreground">
                Install in <span className="font-medium text-foreground">{projectName}</span> for
              </legend>
              <ul className={BOXED}>
                {AGENT_TYPES.map((a) => (
                  <AgentRow
                    key={a}
                    agent={a}
                    checked={agents.includes(a)}
                    installed={installedAgents.includes(a)}
                    onChange={(on) => toggleAgent(a, on)}
                  />
                ))}
              </ul>
              {agents.length === 0 && (
                <p className="px-1 text-[13px] text-muted-foreground">Pick at least one agent.</p>
              )}
            </fieldset>

            <ul className={BOXED}>
              <AuditRow state={audit} />
            </ul>

            {startError && (
              <p role="alert" className="px-1 text-[13px] text-destructive">
                {startError}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <p className="px-1 text-[13px] text-muted-foreground">
            Skills run with the agent's full permissions.
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
              ) : flagged ? (
                "Install Anyway"
              ) : (
                "Install"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Baris agent ala AdwActionRow + GtkCheckButton: logo, nama, folder tujuan
 * (atau "Installed"), kotak centang di kanan. Seluruh baris jadi label;
 * checkbox asli `sr-only` tetap jadi kontrol untuk screen reader & keyboard.
 */
function AgentRow({
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
    <li>
      <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors select-none hover:bg-muted/60 has-focus-visible:bg-muted/60 has-disabled:cursor-not-allowed has-disabled:opacity-60">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <AgentLogo agentType={agent} className="size-[18px] text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] leading-5">{AGENT_TYPE_LABELS[agent]}</span>
          <span className="truncate text-[13px] leading-snug text-muted-foreground">
            {installed ? (
              checked ? (
                "Installed · will reinstall"
              ) : (
                "Installed"
              )
            ) : (
              <span className="font-mono text-xs">{AGENT_SKILLS_DIR[agent]}</span>
            )}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/45",
          )}
        >
          {checked && <CheckIcon className="size-3" strokeWidth={3.5} />}
        </span>
      </label>
    </li>
  );
}

const AUDIT_ICON_CLASS = "size-[18px] shrink-0";

/**
 * Audit keamanan sebagai satu AdwExpanderRow: ikon perisai berwarna sesuai
 * hasil terburuk, subjudul menyebut siapa yang menandai; rincian per
 * partner (status sebagai teks berwarna, tanpa pil) dilipat.
 */
function AuditRow({ state }: { state: IdleLoad<SkillAudit> }) {
  if (state.phase === "loading" || state.phase === "idle") {
    return (
      <ActionRow
        prefix={<Spinner className={cn(AUDIT_ICON_CLASS, "text-muted-foreground")} />}
        title="Security audit"
        subtitle={
          <span role="status" aria-busy="true" className="block">
            <span className="sr-only">Loading security audit…</span>
            <Skeleton className="mt-1 h-3 w-40" />
          </span>
        }
      />
    );
  }
  const question = (
    <ShieldQuestionIcon className={cn(AUDIT_ICON_CLASS, "text-muted-foreground")} aria-hidden />
  );
  if (state.phase === "error") {
    return <ActionRow prefix={question} title="Security audit" subtitle={state.message} />;
  }

  const { audits, overall } = state.data;
  if (audits === null || overall === null) {
    return (
      <ActionRow
        prefix={question}
        title="Not audited yet"
        subtitle="Review the skill on skills.sh before installing."
      />
    );
  }

  const Icon = overall === "pass" ? ShieldCheckIcon : ShieldAlertIcon;
  return (
    <ExpanderRow
      prefix={<Icon className={cn(AUDIT_ICON_CLASS, AUDIT_TEXT_CLASS[overall])} aria-hidden />}
      title="Security audit"
      subtitle={summarizeAudit(audits)}
    >
      <ul className="flex flex-col gap-3">
        {audits.map((a) => (
          <li key={a.provider} className="flex items-start justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{a.provider}</span>
              {a.summary && (
                <span className="line-clamp-2 text-muted-foreground" title={a.summary}>
                  {a.summary}
                </span>
              )}
            </span>
            <span className={cn("shrink-0 font-medium", AUDIT_TEXT_CLASS[a.status])}>
              {AUDIT_LABEL[a.status]}
            </span>
          </li>
        ))}
      </ul>
    </ExpanderRow>
  );
}
