/**
 * Unit test ringkasan Session halaman detail Project
 * (src/lib/session-summary.ts) — logika murni, pola sama dengan
 * `routes.test.ts` dan `project-overview.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import type { Session, SessionStatus } from "@/types";
import {
  describeSessionModel,
  describeSessionSummary,
  sortSessions,
  summarizeSessions,
} from "../session-summary";

function session(id: string, status: SessionStatus, updatedAt: number): Session {
  return {
    id,
    projectId: "p1",
    agentType: "opencode",
    cwd: "/sandbox/p1",
    status,
    ocSessionId: null,
    title: null,
    model: null,
    agent: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("sortSessions", () => {
  test("running di atas crashed, crashed di atas stopped", () => {
    const sorted = sortSessions([
      session("stopped", "stopped", 9_000),
      session("crashed", "crashed", 1_000),
      session("running", "running", 500),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["running", "crashed", "stopped"]);
  });

  test("dalam status yang sama, terakhir diperbarui di atas", () => {
    const sorted = sortSessions([
      session("lama", "running", 1_000),
      session("baru", "running", 5_000),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["baru", "lama"]);
  });

  test("updatedAt sama -> urut berdasarkan id (stabil antar refresh)", () => {
    const sorted = sortSessions([session("b", "running", 1_000), session("a", "running", 1_000)]);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("input tidak dimutasi", () => {
    const input = [session("stopped", "stopped", 1), session("running", "running", 2)];
    sortSessions(input);
    expect(input.map((s) => s.id)).toEqual(["stopped", "running"]);
  });

  test("daftar kosong -> kosong", () => {
    expect(sortSessions([])).toEqual([]);
  });
});

describe("summarizeSessions", () => {
  test("menghitung total dan tiap status", () => {
    const summary = summarizeSessions([
      session("a", "running", 1),
      session("b", "running", 2),
      session("c", "stopped", 3),
      session("d", "crashed", 4),
    ]);
    expect(summary).toEqual({ total: 4, running: 2, stopped: 1, crashed: 1 });
  });

  test("daftar kosong -> semua nol", () => {
    expect(summarizeSessions([])).toEqual({ total: 0, running: 0, stopped: 0, crashed: 0 });
  });
});

describe("describeSessionSummary", () => {
  test("tanpa Session -> teks pengarah", () => {
    expect(describeSessionSummary({ total: 0, running: 0, stopped: 0, crashed: 0 })).toBe(
      "No sessions yet",
    );
  });

  test("hanya total bila tidak ada yang berjalan/crash", () => {
    expect(describeSessionSummary({ total: 2, running: 0, stopped: 2, crashed: 0 })).toBe(
      "2 sessions",
    );
  });

  test("menyebut yang berjalan dan crash", () => {
    expect(describeSessionSummary({ total: 3, running: 1, stopped: 1, crashed: 1 })).toBe(
      "3 sessions · 1 running · 1 crashed",
    );
  });
});

describe("describeSessionModel", () => {
  test("model kosong -> model default", () => {
    expect(describeSessionModel(session("a", "running", 1))).toBe("default model");
  });

  test("model terpilih -> modelID", () => {
    const s = session("a", "running", 1);
    expect(
      describeSessionModel({
        ...s,
        model: { providerID: "kcgcode", modelID: "kiro/claude-opus-5" },
      }),
    ).toBe("kiro/claude-opus-5");
  });
});
