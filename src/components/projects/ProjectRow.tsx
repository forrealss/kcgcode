/**
 * Satu baris Project di homepage. Seluruh baris adalah tombol tunggal (bukan
 * tombol di dalam tombol) agar target sentuh besar di layar HP dan tetap
 * dapat diakses lewat keyboard.
 */
import { ArrowRightIcon } from "lucide-react";
import { formatRelativeTime, type ProjectOverview } from "@/lib/project-overview";

export interface ProjectRowProps {
  overview: ProjectOverview;
  onOpen: () => void;
}

export function ProjectRow({ overview, onOpen }: ProjectRowProps) {
  const { project, sessionCount, runningCount, lastSession, lastActivityAt } = overview;
  const hasSession = lastSession !== null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-accent hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={
        hasSession ? `Resume last session of ${project.name}` : `Open project ${project.name}`
      }
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base font-semibold text-primary uppercase">
        {project.name.trim().charAt(0) || "?"}
        {runningCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
            aria-hidden
          />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base font-medium group-hover:text-primary">
          {project.name}
        </span>
        <span className="truncate font-mono text-sm text-muted-foreground">{project.path}</span>
        <span className="truncate text-sm text-muted-foreground">
          {sessionCount === 0
            ? "No sessions"
            : `${sessionCount} session${sessionCount === 1 ? "" : "s"}`}
          {runningCount > 0 && ` · ${runningCount} running`}
          {" · "}
          {formatRelativeTime(lastActivityAt)}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground group-hover:text-primary">
        <span className="hidden sm:inline">{hasSession ? "Resume" : "Open"}</span>
        <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
