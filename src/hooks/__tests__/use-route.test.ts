/**
 * Unit test router URL tipis (src/hooks/use-route.ts).
 *
 * `bun test` tidak menyediakan DOM, sehingga yang diuji adalah logika murni
 * `parseRoute()` dan pembangun path (`projectsPath`, `projectPath`,
 * `sessionPath`) — pola yang sama dengan test `use-theme.ts`. Hook `useRoute`
 * dan `navigate` (History API) diuji manual via dev server.
 */
import { describe, expect, test } from "bun:test";
import { navigate, parseRoute, projectPath, projectsPath, sessionPath } from "../use-route";

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
    expect(parseRoute("/settings")).toEqual({ name: "not-found" });
    expect(parseRoute("/projects")).toEqual({ name: "not-found" });
    expect(parseRoute("/projects/p1/extra")).toEqual({ name: "not-found" });
    expect(parseRoute("/projects/p1/other/s2")).toEqual({ name: "not-found" });
    // Trailing slash dikonsumsi, jadi ini bukan case "segmen kosong".
    expect(parseRoute("/projects//sessions/s2")).toEqual({ name: "not-found" });
  });
});

describe("navigate", () => {
  test("aman dipanggil tanpa History API (lingkungan non-browser)", () => {
    // Di bun test tidak ada `window` -> tidak boleh melempar.
    expect(() => navigate("/projects/p1")).not.toThrow();
  });
});
