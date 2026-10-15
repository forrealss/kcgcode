import { expect, test } from "bun:test";
import type { ExternalSessionItem } from "@/lib/external-sessions";
import { matchesQuery, searchExternalSessions } from "@/lib/session-search";

test("matchesQuery: semua kata harus muncul, tanpa beda huruf", () => {
  expect(matchesQuery(["Fix flaky test", null], "  ")).toBe(true);
  expect(matchesQuery(["Fix flaky test", null], "FLAKY")).toBe(true);
  expect(matchesQuery(["Fix flaky test", "main"], "flaky main")).toBe(true);
  expect(matchesQuery(["Fix flaky test", "main"], "flaky router")).toBe(false);
});

test("searchExternalSessions: judul, prompt pertama, asal, branch", () => {
  const base = { updatedAt: 1, openElsewhere: false };
  const sessions: ExternalSessionItem[] = [
    { ...base, id: "a", agentType: "claude-code", title: "Refactor", source: "claude-desktop" },
    {
      ...base,
      id: "b",
      agentType: "opencode",
      title: "Docs",
      firstPrompt: "split the Router module",
      source: "opencode",
      gitBranch: "feat/x",
    },
  ];
  const ids = (q: string) => searchExternalSessions(sessions, q).map((s) => s.id);
  expect(ids("")).toEqual(["a", "b"]);
  expect(ids("router")).toEqual(["b"]);
  expect(ids("desktop")).toEqual(["a"]);
  expect(ids("feat/")).toEqual(["b"]);
  expect(ids("nothing")).toEqual([]);
});
