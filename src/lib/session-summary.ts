/**
 * Ringkasan Session untuk halaman detail Project — logika murni (tanpa DOM /
 * fetch), dipisah agar dapat diuji `bun test` seperti `lib/routes.ts` dan
 * `lib/project-overview.ts`.
 *
 * Dipakai `components/sessions/SessionList.tsx`: mengurutkan Session sehingga
 * yang paling relevan untuk dilanjutkan berada di atas, dan menyediakan
 * ringkasan status untuk header Project.
 */

import type { Session, SessionStatus } from "@/types";

/** Ringkasan status seluruh Session milik satu Project. */
export interface SessionSummary {
  total: number;
  running: number;
  stopped: number;
  crashed: number;
}

/** Prioritas urutan status: yang berjalan paling relevan untuk dilanjutkan. */
const STATUS_RANK: Record<SessionStatus, number> = {
  running: 0,
  crashed: 1,
  stopped: 2,
};

/**
 * Urutkan Session: `running` lebih dulu, lalu `crashed` (perlu perhatian),
 * lalu `stopped`; di dalam tiap kelompok yang terakhir diperbarui di atas.
 * Input tidak dimutasi.
 */
export function sortSessions(sessions: readonly Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id.localeCompare(b.id);
  });
}

/** Hitung jumlah Session per status. */
export function summarizeSessions(sessions: readonly Session[]): SessionSummary {
  const summary: SessionSummary = { total: sessions.length, running: 0, stopped: 0, crashed: 0 };
  for (const s of sessions) {
    if (s.status === "running") summary.running += 1;
    else if (s.status === "stopped") summary.stopped += 1;
    else summary.crashed += 1;
  }
  return summary;
}

/**
 * Kalimat ringkas status Project untuk header ("2 session · 1 berjalan").
 * Tanpa Session -> teks pengarah, bukan "0 session".
 */
export function describeSessionSummary(summary: SessionSummary): string {
  if (summary.total === 0) return "Belum ada session";
  const parts = [`${summary.total} session`];
  if (summary.running > 0) parts.push(`${summary.running} berjalan`);
  if (summary.crashed > 0) parts.push(`${summary.crashed} crash`);
  return parts.join(" · ");
}

/** Label model Session untuk baris daftar. */
export function describeSessionModel(session: Session): string {
  return session.model ? session.model.modelID : "model default";
}
