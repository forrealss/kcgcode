import { expect, test } from "bun:test";
import { buildPaletteResults, highlightMatches, RECENT_LIMIT } from "@/lib/search-palette";
import type { SidebarProjectGroup } from "@/lib/sidebar-groups";
import type { Project, Session } from "@/types";

function project(id: string, name: string): Project {
  return { id, name, path: `/sandbox/${name}`, createdAt: 0 };
}

function session(id: string, projectId: string, updatedAt: number, title: string): Session {
  return {
    id,
    projectId,
    agentType: "claude-code",
    cwd: "/sandbox",
    status: "stopped",
    ocSessionId: null,
    title,
    model: null,
    agent: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

const groups: SidebarProjectGroup[] = [
  {
    project: project("p1", "agent-bridger"),
    sessions: [session("a", "p1", 30, "Fix login bug"), session("b", "p1", 10, "Login page")],
    runningCount: 0,
  },
  {
    project: project("p2", "website"),
    sessions: [session("c", "p2", 20, "Refactor header")],
    runningCount: 0,
  },
];

test("buildPaletteResults: kueri kosong = Session terbaru tanpa Project", () => {
  const r = buildPaletteResults(groups, "  ");
  expect(r.projects).toEqual([]);
  expect(r.sessions.map((s) => s.session.id)).toEqual(["a", "c", "b"]);
  expect(r.sessions[0]?.projectName).toBe("agent-bridger");
  expect(RECENT_LIMIT).toBeGreaterThan(0);
});

test("buildPaletteResults: Project dari nama, Session dari judul; awalan judul naik", () => {
  const r = buildPaletteResults(groups, "login");
  expect(r.projects).toEqual([]);
  expect(r.sessions.map((s) => s.session.id)).toEqual(["b", "a"]);

  const byProject = buildPaletteResults(groups, "bridger");
  expect(byProject.projects.map((p) => [p.project.id, p.sessionCount])).toEqual([["p1", 2]]);
  expect(byProject.sessions).toEqual([]);

  // Kata Project + kata judul -> Session Project itu saja.
  expect(buildPaletteResults(groups, "bridger fix").sessions.map((s) => s.session.id)).toEqual([
    "a",
  ]);
  expect(buildPaletteResults(groups, "website fix").sessions).toEqual([]);
});

test("highlightMatches: tandai tiap kata kueri, tanpa beda huruf", () => {
  expect(highlightMatches("Fix login bug", "")).toEqual([{ text: "Fix login bug", match: false }]);
  expect(highlightMatches("Fix Login bug", "login fix")).toEqual([
    { text: "Fix", match: true },
    { text: " ", match: false },
    { text: "Login", match: true },
    { text: " bug", match: false },
  ]);
});
