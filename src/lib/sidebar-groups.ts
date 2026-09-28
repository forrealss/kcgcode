/**
 * Pengelompokan Session per Project untuk sidebar aplikasi — logika murni
 * (tanpa DOM / fetch), dipisah agar dapat diuji `bun test` seperti
 * `lib/project-overview.ts` dan `lib/session-summary.ts`.
 */

import { sortSessions } from "@/lib/session-summary";
import type { Project, Session } from "@/types";

/** Satu grup sidebar: Project + seluruh Session miliknya (terurut). */
export interface SidebarProjectGroup {
  project: Project;
  /** Running -> crashed -> stopped, terbaru di atas (`sortSessions`). */
  sessions: Session[];
  runningCount: number;
}

/**
 * Kelompokkan Session per Project. Grup diurutkan dari aktivitas terbaru
 * (Session `updatedAt` terbesar, atau `createdAt` Project bila kosong);
 * nama sebagai tie-break agar urutan stabil. Session dengan `projectId`
 * tak dikenal diabaikan. Input tidak dimutasi.
 */
export function groupSessionsByProject(
  projects: readonly Project[],
  sessions: readonly Session[],
): SidebarProjectGroup[] {
  const byProject = new Map<string, Session[]>();
  for (const session of sessions) {
    const bucket = byProject.get(session.projectId);
    if (bucket === undefined) byProject.set(session.projectId, [session]);
    else bucket.push(session);
  }

  const groups = projects.map((project) => {
    const own = byProject.get(project.id) ?? [];
    let lastActivity = project.createdAt;
    let runningCount = 0;
    for (const s of own) {
      if (s.status === "running") runningCount += 1;
      if (s.updatedAt > lastActivity) lastActivity = s.updatedAt;
    }
    return { group: { project, sessions: sortSessions(own), runningCount }, lastActivity };
  });

  return groups
    .sort((a, b) => {
      if (b.lastActivity !== a.lastActivity) return b.lastActivity - a.lastActivity;
      return a.group.project.name.localeCompare(b.group.project.name, undefined, {
        sensitivity: "base",
      });
    })
    .map((g) => g.group);
}

/**
 * Filter grup berdasarkan kata kunci: Project yang namanya cocok tampil
 * utuh; selain itu hanya Session yang judulnya cocok yang dipertahankan.
 * Grup tanpa kecocokan dibuang. Query kosong -> grup utuh.
 */
export function filterSidebarGroups(
  groups: readonly SidebarProjectGroup[],
  query: string,
  titleOf: (session: Session) => string,
): SidebarProjectGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...groups];
  const out: SidebarProjectGroup[] = [];
  for (const group of groups) {
    if (group.project.name.toLowerCase().includes(needle)) {
      out.push(group);
      continue;
    }
    const sessions = group.sessions.filter((s) => titleOf(s).toLowerCase().includes(needle));
    if (sessions.length > 0) out.push({ ...group, sessions });
  }
  return out;
}
