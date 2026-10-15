/**
 * Unit test helper panel samping Project (src/lib/project-extensions.ts).
 */
import { describe, expect, test } from "bun:test";
import type { SkillInfo } from "@/types";
import {
  describeMcpEntries,
  describeMcpSummary,
  filterSkills,
  groupSkills,
  mcpActionsFor,
  mergeMcpServers,
} from "../project-extensions";

function skill(name: string, source: SkillInfo["source"], description: string | null = null) {
  return { name, description, location: null, source } satisfies SkillInfo;
}

describe("describeMcpSummary", () => {
  test("kosong -> None configured", () => {
    expect(describeMcpSummary([])).toBe("None configured");
  });

  test("hitung yang connected", () => {
    expect(
      describeMcpSummary([
        { name: "a", status: "connected", error: null },
        { name: "b", status: "failed", error: "x" },
        { name: "c", status: "connected", error: null },
      ]),
    ).toBe("2 of 3 connected");
  });
});

describe("mergeMcpServers", () => {
  test("gabung per nama, catat agent, urut yang bermasalah dulu", () => {
    const entries = mergeMcpServers({
      opencode: [
        { name: "web", status: "connected", error: null },
        { name: "db", status: "connected", error: null },
      ],
      "claude-code": [
        { name: "web", status: "unknown", error: null },
        { name: "db", status: "failed", error: "boom" },
        { name: "cc-only", status: "disabled", error: null },
      ],
    });
    expect(entries.map((e) => [e.name, e.status, e.agents])).toEqual([
      ["db", "failed", ["opencode", "claude-code"]],
      ["web", "connected", ["opencode", "claude-code"]],
      ["cc-only", "disabled", ["claude-code"]],
    ]);
    expect(entries[0]?.byAgent["claude-code"]?.error).toBe("boom");
    // Tersambung di salah satu agent sudah dihitung "connected".
    expect(describeMcpEntries(entries)).toBe("2 of 3 connected");
    expect(describeMcpEntries([])).toBe("None configured");
  });
});

describe("mcpActionsFor", () => {
  test("nonaktif -> hanya Enable; lainnya Reconnect + Disable", () => {
    expect(mcpActionsFor("disabled")).toEqual(["enable"]);
    for (const status of ["connected", "failed", "pending", "needs_auth", "unknown"] as const) {
      expect(mcpActionsFor(status)).toEqual(["reconnect", "disable"]);
    }
  });

  test("urutan perhatian: sedang menyambung di antara bermasalah dan tersambung", () => {
    const entries = mergeMcpServers({
      opencode: [
        { name: "ok", status: "connected", error: null },
        { name: "slow", status: "pending", error: null },
        { name: "auth", status: "needs_auth", error: null },
      ],
    });
    expect(entries.map((e) => e.name)).toEqual(["auth", "slow", "ok"]);
  });
});

describe("groupSkills", () => {
  test("urutan project -> global -> builtin, kelompok kosong dibuang", () => {
    const groups = groupSkills([
      skill("b1", "builtin"),
      skill("p1", "project"),
      skill("p2", "project"),
    ]);
    expect(groups.map((g) => g.source)).toEqual(["project", "builtin"]);
    expect(groups[0]?.skills.map((s) => s.name)).toEqual(["p1", "p2"]);
  });
});

describe("filterSkills", () => {
  const all = [skill("shadcn", "project", "UI components"), skill("firecrawl", "global", "Web")];

  test("query kosong -> semua", () => {
    expect(filterSkills(all, "  ")).toHaveLength(2);
  });

  test("cocok nama atau deskripsi, case-insensitive", () => {
    expect(filterSkills(all, "SHAD").map((s) => s.name)).toEqual(["shadcn"]);
    expect(filterSkills(all, "web").map((s) => s.name)).toEqual(["firecrawl"]);
    expect(filterSkills(all, "zzz")).toEqual([]);
  });
});
