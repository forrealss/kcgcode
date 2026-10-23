/**
 * Unit test ringkasan Project homepage (src/lib/project-overview.ts).
 *
 * Yang diuji: penggabungan Project + Session, urutan aktivitas terbaru,
 * dan label waktu relatif — semuanya logika murni
 * (pola yang sama dengan `routes.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import type { Project, Session, SessionStatus } from "@/types";
import {
  buildProjectOverviews,
  formatRelativeTime,
  RECENT_SESSION_LIMIT,
} from "../project-overview";

function project(id: string, name: string, createdAt: number, path = `/sandbox/${name}`): Project {
  return { id, name, path, createdAt };
}

function session(id: string, projectId: string, status: SessionStatus, updatedAt: number): Session {
  return {
    id,
    projectId,
    agentType: "opencode",
    cwd: "/sandbox",
    status,
    ocSessionId: null,
    title: null,
    model: null,
    agent: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("buildProjectOverviews", () => {
  test("menghitung jumlah Session dan Session berjalan per Project", () => {
    const projects = [project("p1", "alpha", 1_000), project("p2", "beta", 2_000)];
    const sessions = [
      session("s1", "p1", "running", 5_000),
      session("s2", "p1", "stopped", 4_000),
      session("s3", "p2", "crashed", 3_000),
    ];

    const [first, second] = buildProjectOverviews(projects, sessions);

    expect(first?.project.id).toBe("p1");
    expect(first?.sessionCount).toBe(2);
    expect(first?.runningCount).toBe(1);
    expect(first?.lastSession?.id).toBe("s1");
    expect(first?.lastActivityAt).toBe(5_000);

    expect(second?.project.id).toBe("p2");
    expect(second?.runningCount).toBe(0);
    expect(second?.lastSession?.id).toBe("s3");
  });

  test("Project tanpa Session memakai createdAt sebagai aktivitas terakhir", () => {
    const [only] = buildProjectOverviews([project("p1", "alpha", 7_000)], []);
    expect(only?.sessionCount).toBe(0);
    expect(only?.lastSession).toBeNull();
    expect(only?.lastActivityAt).toBe(7_000);
  });

  test("recentSessions: maksimal RECENT_SESSION_LIMIT, terbaru di depan", () => {
    const sessions = [
      session("s1", "p1", "stopped", 1_000),
      session("s2", "p1", "running", 4_000),
      session("s3", "p1", "stopped", 2_000),
      session("s4", "p1", "stopped", 3_000),
    ];
    const [only] = buildProjectOverviews([project("p1", "alpha", 0)], sessions);
    expect(only?.recentSessions.map((s) => s.id)).toEqual(
      ["s2", "s4", "s3"].slice(0, RECENT_SESSION_LIMIT),
    );
    expect(only?.lastSession?.id).toBe("s2");
  });

  test("urutan: aktivitas terbaru di atas", () => {
    const projects = [
      project("p1", "alpha", 1_000),
      project("p2", "beta", 2_000),
      project("p3", "gamma", 3_000),
    ];
    const sessions = [session("s1", "p1", "stopped", 9_000)];

    const ids = buildProjectOverviews(projects, sessions).map((o) => o.project.id);
    expect(ids).toEqual(["p1", "p3", "p2"]);
  });

  test("aktivitas sama diurut berdasarkan nama (case-insensitive)", () => {
    const projects = [project("p1", "Zeta", 1_000), project("p2", "alpha", 1_000)];
    const ids = buildProjectOverviews(projects, []).map((o) => o.project.id);
    expect(ids).toEqual(["p2", "p1"]);
  });

  test("Session dengan projectId tak dikenal diabaikan", () => {
    const overviews = buildProjectOverviews(
      [project("p1", "alpha", 1_000)],
      [session("s1", "ghost", "running", 9_000)],
    );
    expect(overviews).toHaveLength(1);
    expect(overviews[0]?.sessionCount).toBe(0);
  });

  test("daftar Project kosong -> hasil kosong", () => {
    expect(buildProjectOverviews([], [session("s1", "p1", "running", 1)])).toEqual([]);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const minute = 60_000;

  test("kurang dari satu menit -> just now", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
  });

  test("timestamp di masa depan tetap just now", () => {
    expect(formatRelativeTime(now + minute, now)).toBe("just now");
  });

  test("skala menit, jam, dan hari", () => {
    expect(formatRelativeTime(now - 5 * minute, now)).toBe("5 minutes ago");
    expect(formatRelativeTime(now - 3 * 60 * minute, now)).toBe("3 hours ago");
    expect(formatRelativeTime(now - 2 * 24 * 60 * minute, now)).toBe("2 days ago");
  });

  test("lebih dari sepekan -> tanggal absolut", () => {
    const old = now - 30 * 24 * 60 * minute;
    expect(formatRelativeTime(old, now)).toBe(
      new Date(old).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    );
  });
});
