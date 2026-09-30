/**
 * Unit test logika rute murni (src/lib/routes.ts).
 *
 * `bun test` tidak menyediakan DOM, sehingga yang diuji adalah
 * `parseRoute()` dan pembangun path (`projectsPath`, `projectPath`,
 * `sessionPath`) — pola yang sama dengan test `useTheme.ts`. Hook
 * `useRouter` dan `navigate` (History API) diuji manual via dev server.
 */
import { describe, expect, test } from "bun:test";
import {
  parseRoute,
  parseSkillsProject,
  projectPath,
  projectsPath,
  sessionPath,
  settingsPath,
  skillsPath,
} from "../routes";

describe("pembangun path", () => {
  test("projectsPath menghasilkan /", () => {
    expect(projectsPath()).toBe("/");
  });

  test("projectPath menyisipkan id Project", () => {
    expect(projectPath("abc-123")).toBe("/projects/abc-123");
  });

  test("sessionPath menyisipkan id Project dan id Session", () => {
    expect(sessionPath("p1", "s2")).toBe("/projects/p1/sessions/s2");
  });
});

describe("parseRoute", () => {
  test("pathname kosong / root -> projects", () => {
    expect(parseRoute("/")).toEqual({ name: "projects" });
    expect(parseRoute("")).toEqual({ name: "projects" });
  });

  test("trailing slash diabaikan", () => {
    expect(parseRoute("/projects/p1/")).toEqual({ name: "project", projectId: "p1" });
    expect(parseRoute("/projects/p1/sessions/s2/")).toEqual({
      name: "session",
      projectId: "p1",
      sessionId: "s2",
    });
  });

  test("URL daftar Session Project", () => {
    expect(parseRoute("/projects/p1")).toEqual({ name: "project", projectId: "p1" });
  });

  test("URL Session view", () => {
    expect(parseRoute("/projects/p1/sessions/s2")).toEqual({
      name: "session",
      projectId: "p1",
      sessionId: "s2",
    });
  });

  test("id UUID tetap opaque (tanpa decoding khusus)", () => {
    const id = "6f0a2b1e-9c4d-4f6a-8e1b-2c3d4e5f6a7b";
    expect(parseRoute(`/projects/${id}`)).toEqual({ name: "project", projectId: id });
    expect(parseRoute(`/projects/${id}/sessions/${id}`)).toEqual({
      name: "session",
      projectId: id,
      sessionId: id,
    });
  });

  test("path tak dikenal -> not-found", () => {
    expect(parseRoute("/preferences")).toEqual({ name: "not-found" });
    expect(parseRoute("/projects")).toEqual({ name: "not-found" });
    expect(parseRoute("/projects/p1/extra")).toEqual({ name: "not-found" });
    expect(parseRoute("/projects/p1/other/s2")).toEqual({ name: "not-found" });
    // Trailing slash dikonsumsi, jadi ini bukan case "segmen kosong".
    expect(parseRoute("/projects//sessions/s2")).toEqual({ name: "not-found" });
  });
});

describe("rute skills", () => {
  test("skillsPath menghasilkan /skills", () => {
    expect(skillsPath()).toBe("/skills");
  });

  test("/skills (dengan/tanpa trailing slash) -> skills", () => {
    expect(parseRoute("/skills")).toEqual({ name: "skills" });
    expect(parseRoute("/skills/")).toEqual({ name: "skills" });
  });

  test("skillsPath dengan Project menambahkan ?project=", () => {
    expect(skillsPath("p1")).toBe("/skills?project=p1");
    expect(skillsPath(null)).toBe("/skills");
  });

  test("parseSkillsProject membaca ?project=", () => {
    expect(parseSkillsProject("?project=p1")).toBe("p1");
    expect(parseSkillsProject("")).toBeNull();
    expect(parseSkillsProject("?project=")).toBeNull();
  });

  test("sub-path skills tidak dikenal -> not-found", () => {
    expect(parseRoute("/skills/x")).toEqual({ name: "not-found" });
  });
});

describe("rute settings", () => {
  test("settingsPath & parseRoute", () => {
    expect(settingsPath()).toBe("/settings");
    expect(parseRoute("/settings")).toEqual({ name: "settings", section: "profile" });
    expect(parseRoute("/settings/")).toEqual({ name: "settings", section: "profile" });
    expect(parseRoute("/settings/x")).toEqual({ name: "not-found" });
    expect(parseRoute("/settings/security/x")).toEqual({ name: "not-found" });
  });

  test("sub-halaman settings", () => {
    for (const section of ["profile", "security", "remote", "devices"] as const) {
      expect(settingsPath(section)).toBe(`/settings/${section}`);
      expect(parseRoute(`/settings/${section}`)).toEqual({ name: "settings", section });
      expect(parseRoute(`/settings/${section}/`)).toEqual({ name: "settings", section });
    }
  });
});
