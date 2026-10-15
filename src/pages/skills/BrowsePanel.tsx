/**
 * Tab Browse halaman Skills: chip saran saat query masih pendek, lalu hasil
 * skills.sh sebagai grid kartu (urut jumlah install).
 */
import { SearchIcon } from "lucide-react";
import { RegistrySkillCard, SkillCardSkeleton, SkillGrid } from "@/components/skills/SkillCards";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { IdleLoad } from "@/lib/load-state";
import { revealInstall } from "@/lib/skill-installs";
import { SEARCH_SUGGESTIONS } from "@/lib/skills-catalog";
import type { RegistrySkill } from "@/server/services/skills-registry";
import type { AgentType } from "@/types";

export function BrowsePanel({
  query,
  canSearch,
  results,
  installedAgents,
  isInstalling,
  onSuggest,
  onInstall,
}: {
  query: string;
  canSearch: boolean;
  results: IdleLoad<RegistrySkill[]>;
  /** Agent yang sudah memuat skill katalog ini dari folder Project. */
  installedAgents: (skill: RegistrySkill) => AgentType[];
  /** Id job instalasi berjalan untuk skill ini (null bila tidak ada). */
  isInstalling: (skill: RegistrySkill) => string | null;
  onSuggest: (q: string) => void;
  onInstall: (skill: RegistrySkill) => void;
}) {
  if (!canSearch) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <SearchIcon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            {query.length === 1 ? "Keep typing…" : "Search the skills.sh directory"}
          </p>
          <p className="text-sm text-muted-foreground">
            Type at least 2 characters, or start with a popular topic.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {SEARCH_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (results.phase === "idle" || results.phase === "loading") return <SkillCardSkeleton />;
  if (results.phase === "error") {
    return (
      <p
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {results.message}
      </p>
    );
  }
  if (results.data.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchIcon />
          </EmptyMedia>
          <EmptyTitle>No skills found</EmptyTitle>
          <EmptyDescription>
            Nothing on skills.sh matches “{query}”. Try a broader keyword.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section aria-label="Search results" className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {results.data.length} {results.data.length === 1 ? "result" : "results"} for “{query}” ·
        sorted by installs
      </p>
      <SkillGrid label="Skills on skills.sh">
        {results.data.map((skill) => {
          const jobId = isInstalling(skill);
          return (
            <RegistrySkillCard
              key={skill.id}
              skill={skill}
              installedAgents={installedAgents(skill)}
              installing={jobId !== null}
              onInstall={onInstall}
              onShowProgress={() => {
                if (jobId) revealInstall(jobId);
              }}
            />
          );
        })}
      </SkillGrid>
    </section>
  );
}
