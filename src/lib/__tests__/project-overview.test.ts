/**
 * Unit test ringkasan Project homepage (src/lib/project-overview.ts).
 *
 * Yang diuji: penggabungan Project + Session, urutan aktivitas terbaru,
 * filter pencarian, dan label waktu relatif — semuanya logika murni
 * (pola yang sama dengan `routes.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import type { Project, Session, SessionStatus } from "@/types";
import {
  buildProjectOverviews,
  filterProjectOverviews,
  formatRelativeTime,
  totalRunningSessions,
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
    model: null,
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

describe("filterProjectOverviews", () => {
  const overviews = buildProjectOverviews(
    [
      project("p1", "web-app", 1_000, "/sandbox/web-app"),
      project("p2", "api-service", 2_000, "/sandbox/backend/api"),
    ],
    [],
  );

  test("query kosong mengembalikan semua", () => {
    expect(filterProjectOverviews(overviews, "")).toHaveLength(2);
    expect(filterProjectOverviews(overviews, "   ")).toHaveLength(2);
  });

  test("cocok pada nama tanpa membedakan huruf besar/kecil", () => {
    const found = filterProjectOverviews(overviews, "WEB");
    expect(found.map((o) => o.project.id)).toEqual(["p1"]);
  });

  test("cocok pada path", () => {
    const found = filterProjectOverviews(overviews, "backend");
    expect(found.map((o) => o.project.id)).toEqual(["p2"]);
  });

  test("tidak ada yang cocok -> kosong", () => {
    expect(filterProjectOverviews(overviews, "zzz")).toEqual([]);
  });
});

describe("totalRunningSessions", () => {
  test("menjumlahkan Session berjalan seluruh Project", () => {
    const overviews = buildProjectOverviews(
      [project("p1", "alpha", 1), project("p2", "beta", 2)],
      [
        session("s1", "p1", "running", 10),
        session("s2", "p1", "running", 11),
        session("s3", "p2", "stopped", 12),
      ],
    );
    expect(totalRunningSessions(overviews)).toBe(2);
  });

  test("tanpa Session -> 0", () => {
    expect(totalRunningSessions([])).toBe(0);
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
