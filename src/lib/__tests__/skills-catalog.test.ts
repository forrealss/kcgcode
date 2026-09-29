/**
 * Unit test helper katalog skill (src/lib/skills-catalog.ts).
 */
import { describe, expect, test } from "bun:test";
import type { SkillInfo } from "@/server/services/opencode-client";
import type { RegistrySkill } from "@/server/services/skills-registry";
import type { Project } from "@/types";
import {
  formatInstalls,
  githubOwner,
  installedProjectSkillNames,
  isInstalled,
  resolveSkillsProject,
  visibleInstalledSkills,
} from "../skills-catalog";

describe("formatInstalls", () => {
  test("ringkas per ribuan / jutaan", () => {
    expect(formatInstalls(0)).toBe("0");
    expect(formatInstalls(950)).toBe("950");
    expect(formatInstalls(1000)).toBe("1K");
    expect(formatInstalls(1234)).toBe("1.2K");
    expect(formatInstalls(752_553)).toBe("753K");
    expect(formatInstalls(1_300_000)).toBe("1.3M");
  });
});

describe("deteksi terpasang", () => {
  const skills: SkillInfo[] = [
    {
      name: "find-skills",
      description: null,
      location: "/p/.agents/skills/find-skills/SKILL.md",
      source: "project",
    },
    { name: "Global-One", description: null, location: "/home/u/.config/x", source: "global" },
    { name: "builtin", description: null, location: null, source: "builtin" },
  ];
  const reg = (skillId: string, name = skillId): RegistrySkill => ({
    id: `a/b/${skillId}`,
    name,
    source: "a/b",
    skillId,
    installs: 1,
    url: "",
  });

  test("hanya skill sumber project yang dihitung, case-insensitive", () => {
    const names = installedProjectSkillNames(skills);
    expect([...names]).toEqual(["find-skills"]);
    expect(isInstalled(reg("FIND-SKILLS"), names)).toBe(true);
    expect(isInstalled(reg("other", "find-skills"), names)).toBe(true);
    expect(isInstalled(reg("global-one"), names)).toBe(false);
  });
});

describe("resolveSkillsProject", () => {
  const p = (id: string): Project => ({ id, name: id, path: `/${id}`, createdAt: 1 });
  const projects = [p("a"), p("b")];

  test("URL menang, lalu tersimpan; id tak dikenal dilewati", () => {
    expect(resolveSkillsProject(projects, "b", "a")?.id).toBe("b");
    expect(resolveSkillsProject(projects, "gone", "a")?.id).toBe("a");
    expect(resolveSkillsProject(projects, null, "gone")).toBeNull();
    expect(resolveSkillsProject(projects, null, null)).toBeNull();
  });

  test("satu-satunya Project dipilih otomatis", () => {
    expect(resolveSkillsProject([p("only")], null, null)?.id).toBe("only");
    expect(resolveSkillsProject([], null, null)).toBeNull();
  });
});

describe("githubOwner", () => {
  test("owner/repo -> owner; domain / bentuk lain -> null", () => {
    expect(githubOwner("vercel-labs/skills")).toBe("vercel-labs");
    expect(githubOwner("mintlify.com")).toBeNull();
    expect(githubOwner("a/b/c")).toBeNull();
  });
});

describe("visibleInstalledSkills", () => {
  const s = (name: string, source: SkillInfo["source"], description: string | null = null) => ({
    name,
    description,
    location: null,
    source,
  });
  const all = [s("g1", "global"), s("builtin", "builtin"), s("p1", "project", "React helper")];

  test("tanpa bawaan, project dulu, filter nama/deskripsi", () => {
    expect(visibleInstalledSkills(all, "").map((x) => x.name)).toEqual(["p1", "g1"]);
    expect(visibleInstalledSkills(all, "react").map((x) => x.name)).toEqual(["p1"]);
    expect(visibleInstalledSkills(all, "G1").map((x) => x.name)).toEqual(["g1"]);
  });
});
