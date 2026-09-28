/**
 * Unit test pengelompokan Session per Project untuk sidebar
 * (src/lib/sidebar-groups.ts) — logika murni.
 */
import { describe, expect, test } from "bun:test";
import type { Project, Session, SessionStatus } from "@/types";
import { filterSidebarGroups, groupSessionsByProject } from "../sidebar-groups";

function project(id: string, name: string, createdAt: number): Project {
  return { id, name, path: `/sandbox/${name}`, createdAt };
}

function session(
  id: string,
  projectId: string,
  status: SessionStatus,
  updatedAt: number,
  title: string | null = null,
): Session {
  return {
    id,
    projectId,
    agentType: "opencode",
    cwd: "/sandbox",
    status,
    ocSessionId: null,
    title,
    model: null,
    agent: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

const titleOf = (s: Session) => s.title ?? "New session";

describe("groupSessionsByProject", () => {
  test("mengelompokkan Session per Project dan menghitung yang running", () => {
    const groups = groupSessionsByProject(
      [project("p1", "alpha", 1), project("p2", "beta", 2)],
      [
        session("s1", "p1", "running", 10),
        session("s2", "p1", "stopped", 20),
        session("s3", "p2", "running", 5),
      ],
    );
    const alpha = groups.find((g) => g.project.id === "p1");
    expect(alpha?.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(alpha?.runningCount).toBe(1);
    expect(groups.find((g) => g.project.id === "p2")?.sessions).toHaveLength(1);
  });

  test("Project dengan aktivitas terbaru di atas; Project kosong tetap tampil", () => {
    const groups = groupSessionsByProject(
      [project("p1", "alpha", 1), project("p2", "beta", 2), project("p3", "gamma", 100)],
      [session("s1", "p1", "stopped", 50), session("s2", "p2", "stopped", 80)],
    );
    expect(groups.map((g) => g.project.id)).toEqual(["p3", "p2", "p1"]);
    expect(groups[0]?.sessions).toEqual([]);
  });

  test("Session dengan projectId tak dikenal diabaikan", () => {
    const groups = groupSessionsByProject(
      [project("p1", "alpha", 1)],
      [session("s1", "ghost", "running", 10)],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions).toEqual([]);
  });
});

describe("filterSidebarGroups", () => {
  const groups = groupSessionsByProject(
    [project("p1", "alpha", 1), project("p2", "beta", 2)],
    [
      session("s1", "p1", "running", 10, "Fix login bug"),
      session("s2", "p1", "stopped", 20, "Add sidebar"),
      session("s3", "p2", "running", 5, "Refactor login"),
    ],
  );

  test("query kosong mengembalikan semua grup", () => {
    expect(filterSidebarGroups(groups, "  ", titleOf)).toHaveLength(2);
  });

  test("nama Project cocok -> grup utuh", () => {
    const out = filterSidebarGroups(groups, "ALPHA", titleOf);
    expect(out).toHaveLength(1);
    expect(out[0]?.sessions).toHaveLength(2);
  });

  test("judul Session cocok -> hanya Session tersebut, grup kosong dibuang", () => {
    const out = filterSidebarGroups(groups, "login", titleOf);
    expect(out.map((g) => g.sessions.map((s) => s.id))).toEqual([["s1"], ["s3"]]);
    expect(filterSidebarGroups(groups, "sidebar", titleOf).map((g) => g.project.id)).toEqual([
      "p1",
    ]);
    expect(filterSidebarGroups(groups, "zzz", titleOf)).toEqual([]);
  });
});
