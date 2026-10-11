/**
 * Daftar "lanjutkan" di homepage: beberapa Session terbaru milik Project yang
 * sedang dipilih di composer (`HomeChat`). Ringkas — titik status, judul,
 * logo agent, waktu relatif — plus tautan ke daftar Session lengkap.
 *
 * Datanya sudah ada di `ProjectOverview.recentSessions`, jadi tidak ada fetch.
 */
import { ArrowRightIcon } from "lucide-react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { useRouter } from "@/hooks/useRouter";
import { formatRelativeTime, type ProjectOverview } from "@/lib/project-overview";
import { projectPath, sessionPath } from "@/lib/routes";
import { SESSION_STATUS_DOT, SESSION_STATUS_LABEL } from "@/lib/session-status";
import { displaySessionTitle } from "@/lib/session-title";
import { cn } from "@/lib/utils";

export interface HomeRecentSessionsProps {
  overview: ProjectOverview;
  className?: string;
}

export function HomeRecentSessions({ overview, className }: HomeRecentSessionsProps) {
  const { navigate } = useRouter();
  const { project, recentSessions, sessionCount } = overview;
  if (recentSessions.length === 0) return null;

  // Tautan biasa (bukan tombol) agar buka-di-tab-baru tetap berfungsi.
  const go = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  const allHref = projectPath(project.id);

  return (
    <section
      aria-label={`Recent sessions in ${project.name}`}
      className={cn("flex flex-col", className)}
    >
      {/* Label + garis rambut: menandai section terpisah dari composer di
          atasnya (bukan kelanjutan tray Project/model). */}
      <div className="flex items-center gap-3 px-3 pb-2">
        <h2 className="shrink-0 text-xs font-medium text-muted-foreground">Recent sessions</h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
        {sessionCount > recentSessions.length && (
          <a
            href={allHref}
            onClick={(e) => go(e, allHref)}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View all {sessionCount}
            <ArrowRightIcon className="size-3" />
          </a>
        )}
      </div>
      <ul className="flex flex-col">
        {recentSessions.map((session) => {
          const href = sessionPath(project.id, session.id);
          const title = displaySessionTitle(session.title);
          return (
            <li key={session.id}>
              <a
                href={href}
                onClick={(e) => go(e, href)}
                aria-label={`Open session ${title}, ${SESSION_STATUS_LABEL[session.status]}`}
                className="group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", SESSION_STATUS_DOT[session.status])}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">
                  {title}
                </span>
                <AgentLogo
                  agentType={session.agentType}
                  className="size-3.5 text-muted-foreground"
                />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTime(session.updatedAt)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
