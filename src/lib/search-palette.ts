/**
 * Isi command palette pencarian (`SearchDialog`) — logika murni:
 * - Kueri kosong: Session terbaru lintas Project.
 * - Ada kueri: Project yang namanya cocok, lalu Session yang cocok (semua
 *   kata, tanpa beda huruf, boleh tersebar di judul / model / nama Project
 *   asal satu kata kena judul / model). Judul yang diawali kueri naik ke
 *   atas, sisanya terbaru dulu.
 * - `highlightMatches`: potong teks jadi bagian cocok / tidak untuk ditebalkan.
 */

import { matchesQuery } from "@/lib/session-search";
import { describeSessionModel } from "@/lib/session-summary";
import { displaySessionTitle } from "@/lib/session-title";
import type { SidebarProjectGroup } from "@/lib/sidebar-groups";
import type { Project, Session } from "@/types";

export const RECENT_LIMIT = 8;
export const PROJECT_LIMIT = 5;
export const SESSION_LIMIT = 50;

export interface PaletteProject {
  project: Project;
  sessionCount: number;
}

export interface PaletteSession {
  session: Session;
  title: string;
  projectName: string;
}

export interface PaletteResults {
  projects: PaletteProject[];
  sessions: PaletteSession[];
}

export function buildPaletteResults(
  groups: readonly SidebarProjectGroup[],
  query: string,
): PaletteResults {
  const q = query.trim().toLowerCase();
  const all: PaletteSession[] = groups.flatMap((g) =>
    g.sessions.map((session) => ({
      session,
      title: displaySessionTitle(session.title),
      projectName: g.project.name,
    })),
  );
  const newest = (a: PaletteSession, b: PaletteSession) =>
    b.session.updatedAt - a.session.updatedAt;

  if (q === "") return { projects: [], sessions: all.sort(newest).slice(0, RECENT_LIMIT) };

  const projects = groups
    .filter((g) => matchesQuery([g.project.name], q))
    .slice(0, PROJECT_LIMIT)
    .map((g) => ({ project: g.project, sessionCount: g.sessions.length }));

  const starts = (s: PaletteSession) => (s.title.toLowerCase().startsWith(q) ? 0 : 1);
  // Semua kata boleh tersebar di judul / model / nama Project ("bridger
  // login"), tapi minimal satu kata harus kena judul / model — kueri yang
  // hanya nama Project cukup ditampilkan sebagai baris Project.
  const words = q.split(/\s+/);
  const sessions = all
    .filter((s) => {
      const own = [s.title, describeSessionModel(s.session)];
      return matchesQuery([...own, s.projectName], q) && words.some((w) => matchesQuery(own, w));
    })
    .sort((a, b) => starts(a) - starts(b) || newest(a, b))
    .slice(0, SESSION_LIMIT);

  return { projects, sessions };
}

/** Bagian teks; `match` = cocok dengan salah satu kata kueri. */
export interface TextPart {
  text: string;
  match: boolean;
}

export function highlightMatches(text: string, query: string): TextPart[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + w.length)) {
      marked.fill(true, i, i + w.length);
    }
  }
  const parts: TextPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else parts.push({ text: text[i] as string, match: marked[i] as boolean });
  }
  return parts.length > 0 ? parts : [{ text, match: false }];
}
