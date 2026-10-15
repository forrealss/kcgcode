/**
 * Tab Installed halaman Skills: skill terpasang di Project (+ global) sebagai
 * grid kartu, difilter lokal; catatan bila sebagian agent gagal dibaca.
 */
import { SearchIcon, SparklesIcon } from "lucide-react";
import { InstalledSkillCard, SkillCardSkeleton, SkillGrid } from "@/components/skills/SkillCards";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { IdleLoad } from "@/lib/load-state";
import type { InstalledSkill } from "@/lib/skills-catalog";

export function InstalledPanel({
  state,
  warning,
  skills,
  total,
  query,
  onBrowse,
}: {
  state: IdleLoad<InstalledSkill[]>;
  /** Sebagian agent gagal dibaca. */
  warning: string | null;
  skills: InstalledSkill[];
  total: number;
  query: string;
  onBrowse: () => void;
}) {
  if (state.phase === "idle" || state.phase === "loading") return <SkillCardSkeleton />;
  if (state.phase === "error") {
    return (
      <p
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {state.message}
      </p>
    );
  }

  const warningNote = warning && (
    <p role="status" className="mb-3 text-xs text-muted-foreground">
      {warning}
    </p>
  );

  if (total === 0) {
    return (
      <>
        {warningNote}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>No skills installed yet</EmptyTitle>
            <EmptyDescription>
              Browse skills.sh to add your first skill to this project.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" variant="outline" onClick={onBrowse}>
              <SearchIcon data-icon="inline-start" />
              Browse skills
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  if (skills.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No installed skills match “{query}”.
      </p>
    );
  }

  return (
    <section aria-label="Installed skills" className="flex flex-col gap-3">
      {warning && (
        <p role="status" className="text-xs text-muted-foreground">
          {warning}
        </p>
      )}
      {query !== "" && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {skills.length} of {total} installed skills
        </p>
      )}
      <SkillGrid label="Installed skills">
        {skills.map((skill) => (
          <InstalledSkillCard key={`${skill.source}:${skill.name}`} skill={skill} />
        ))}
      </SkillGrid>
    </section>
  );
}
