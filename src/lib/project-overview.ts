/**
 * Ringkasan Project untuk homepage — logika murni (tanpa DOM / fetch).
 *
 * Homepage (`pages/projects/ProjectsPage.tsx`) menggabungkan `GET /api/projects`
 * dengan `GET /api/sessions` agar setiap Project bisa langsung "dilanjutkan":
 * jumlah Session, Session yang sedang berjalan, dan Session terakhir yang
 * disentuh. Dipisah ke `lib/` supaya bisa diuji `bun test` (pola yang sama
 * dengan `lib/routes.ts`).
 */

import type { Project, Session } from "@/types";

/** Project + agregat Session miliknya, siap dirender di daftar homepage. */
export interface ProjectOverview {
  project: Project;
  /** Jumlah Session milik Project ini. */
  sessionCount: number;
  /** Jumlah Session berstatus `running`. */
  runningCount: number;
  /**
   * Session yang paling baru diperbarui (`updatedAt` terbesar) — target tombol
   * "Lanjutkan"; `null` bila Project belum punya Session.
   */
  lastSession: Session | null;
  /**
   * Waktu aktivitas terakhir: `updatedAt` Session terbaru, atau `createdAt`
   * Project bila belum ada Session. Dipakai untuk urutan daftar.
   */
  lastActivityAt: number;
}

/**
 * Gabungkan Project dengan Session-nya, terurut dari aktivitas terbaru.
 * Session dengan `projectId` yang tidak dikenal diabaikan.
 */
export function buildProjectOverviews(
  projects: readonly Project[],
  sessions: readonly Session[],
): ProjectOverview[] {
  const byProject = new Map<string, Session[]>();
  for (const session of sessions) {
    const bucket = byProject.get(session.projectId);
    if (bucket === undefined) byProject.set(session.projectId, [session]);
    else bucket.push(session);
  }

  const overviews = projects.map((project) => {
    const own = byProject.get(project.id) ?? [];
    let lastSession: Session | null = null;
    let runningCount = 0;
    for (const session of own) {
      if (session.status === "running") runningCount += 1;
      if (lastSession === null || session.updatedAt > lastSession.updatedAt) {
        lastSession = session;
      }
    }
    return {
      project,
      sessionCount: own.length,
      runningCount,
      lastSession,
      lastActivityAt: lastSession?.updatedAt ?? project.createdAt,
    };
  });

  // Aktivitas terbaru di atas; nama (case-insensitive) sebagai tie-break agar
  // urutan stabil dan tidak berubah-ubah antar refresh.
  return overviews.sort((a, b) => {
    if (b.lastActivityAt !== a.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
    return a.project.name.localeCompare(b.project.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Filter daftar berdasarkan kata kunci (cocok pada nama atau path, tanpa
 * membedakan huruf besar/kecil). Query kosong/whitespace -> daftar utuh.
 */
export function filterProjectOverviews(
  overviews: readonly ProjectOverview[],
  query: string,
): ProjectOverview[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...overviews];
  return overviews.filter(
    ({ project }) =>
      project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle),
  );
}

/** Total Session yang sedang berjalan di seluruh Project. */
export function totalRunningSessions(overviews: readonly ProjectOverview[]): number {
  return overviews.reduce((sum, o) => sum + o.runningCount, 0);
}

/**
 * Short relative label for activity time ("just now", "3 hours ago").
 * `now` diinjeksi agar deterministik saat diuji.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 0) return "just now";

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)} minutes ago`;
  if (diff < day) return `${Math.floor(diff / hour)} hours ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;

  return new Date(ts).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
