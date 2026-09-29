/**
 * Kartu skill untuk grid 2 kolom di halaman Skills.
 *
 * - `RegistrySkillCard`: hasil skills.sh — nama (tautan), owner/repo, jumlah
 *   install, tombol Install / "Installing…" (klik = lihat progres) /
 *   status "Installed".
 * - `InstalledSkillCard`: skill terpasang — nama, label asal, deskripsi.
 * - `SkillCardSkeleton`: placeholder saat memuat.
 * Semua kartu setinggi baris grid (`h-full`) agar grid rapi.
 */
import { CheckIcon, DownloadIcon, ExternalLinkIcon, PlusIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { SKILL_SOURCE_LABEL } from "@/lib/project-extensions";
import { formatInstalls, githubOwner } from "@/lib/skills-catalog";
import { cn } from "@/lib/utils";
import type { SkillInfo } from "@/server/services/opencode-client";
import type { RegistrySkill } from "@/server/services/skills-registry";

/** Grid kartu: 1 kolom di HP, 2 kolom mulai `md`. */
export function SkillGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {children}
    </ul>
  );
}

function CardShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <li
      className={cn(
        "flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors",
        className,
      )}
    >
      {children}
    </li>
  );
}

/** Avatar owner GitHub; jatuh ke ikon bila bukan sumber GitHub / gagal dimuat. */
function SourceAvatar({ source }: { source: string }) {
  const owner = githubOwner(source);
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      <SparklesIcon className="size-4" aria-hidden />
      {owner && (
        <img
          src={`https://github.com/${encodeURIComponent(owner)}.png?size=80`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </span>
  );
}

export function RegistrySkillCard({
  skill,
  installed,
  installing,
  onInstall,
  onShowProgress,
}: {
  skill: RegistrySkill;
  installed: boolean;
  /** Ada job instalasi berjalan untuk skill ini di Project terpilih. */
  installing: boolean;
  onInstall: (skill: RegistrySkill) => void;
  /** Tampilkan lagi notifikasi progres instalasinya. */
  onShowProgress: () => void;
}) {
  return (
    <CardShell className="hover:border-foreground/20">
      <div className="flex min-w-0 items-start gap-3">
        <SourceAvatar source={skill.source} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <a
            href={skill.url}
            target="_blank"
            rel="noopener noreferrer"
            title={skill.name}
            className="group/link flex min-w-0 items-center gap-1 text-sm font-semibold leading-5 hover:underline"
          >
            <span className="truncate">{skill.name}</span>
            <ExternalLinkIcon
              className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100 group-focus-visible/link:opacity-100"
              aria-hidden
            />
            <span className="sr-only"> on skills.sh (opens in a new tab)</span>
          </a>
          <span className="truncate font-mono text-xs text-muted-foreground" title={skill.source}>
            {skill.source}
          </span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
          <DownloadIcon className="size-3.5" aria-hidden />
          <span className="sr-only">Installs:</span>
          {formatInstalls(skill.installs)}
          <span aria-hidden> installs</span>
        </span>
        {installing ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onShowProgress}
            aria-label={`Installing ${skill.name}. Show progress`}
          >
            <Spinner data-icon="inline-start" />
            Installing…
          </Button>
        ) : installed ? (
          <span className="flex h-8 items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckIcon className="size-3.5" aria-hidden />
            Installed
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onInstall(skill)}
            aria-label={`Install ${skill.name}`}
          >
            <PlusIcon data-icon="inline-start" />
            Install
          </Button>
        )}
      </div>
    </CardShell>
  );
}

export function InstalledSkillCard({ skill }: { skill: SkillInfo }) {
  const isProject = skill.source === "project";
  return (
    <CardShell>
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            isProject ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <SparklesIcon className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold leading-5" title={skill.name}>
              {skill.name}
            </span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 text-[10px] leading-4 font-medium",
                isProject ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {SKILL_SOURCE_LABEL[skill.source]}
            </span>
          </span>
          <p
            className={cn(
              "line-clamp-3 text-xs leading-relaxed",
              skill.description ? "text-muted-foreground" : "text-muted-foreground/60 italic",
            )}
            title={skill.description ?? undefined}
          >
            {skill.description ?? "No description"}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

export function SkillCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <span className="sr-only">Loading skills…</span>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder statis
        <div key={i} className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-hidden>
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4" style={{ width: `${75 - (i % 3) * 15}%` }} />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
