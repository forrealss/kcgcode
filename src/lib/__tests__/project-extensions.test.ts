/**
 * Unit test helper panel samping Project (src/lib/project-extensions.ts).
 */
import { describe, expect, test } from "bun:test";
import type { SkillInfo } from "@/server/services/opencode-client";
import { describeMcpSummary, filterSkills, groupSkills } from "../project-extensions";

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
