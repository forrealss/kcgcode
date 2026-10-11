/**
 * Unit test pemindai skill Claude Code (src/server/services/claude-skills.ts)
 * — frontmatter SKILL.md dan pemindaian `.claude/skills` di direktori temp.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeGlobalSkillsDir, listClaudeSkills, parseSkillFrontmatter } from "../claude-skills";

function writeSkill(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

describe("parseSkillFrontmatter", () => {
  test("nilai satu baris, berkutip maupun tidak", () => {
    expect(
      parseSkillFrontmatter('---\nname: pdf\ndescription: "Read PDFs: fast"\n---\n# PDF'),
    ).toEqual({ name: "pdf", description: "Read PDFs: fast" });
  });

  test("blok `>` digabung menjadi satu baris", () => {
    expect(
      parseSkillFrontmatter("---\nname: x\ndescription: >\n  first line\n  second line\n---\n"),
    ).toEqual({ name: "x", description: "first line second line" });
  });

  test("tanpa frontmatter -> null", () => {
    expect(parseSkillFrontmatter("# Just markdown")).toEqual({ name: null, description: null });
  });
});

describe("listClaudeSkills", () => {
  test("Project + global, ikuti symlink, fallback nama folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "kcg-cc-skills-"));
    const project = join(root, "proj");
    const global = join(root, "home-skills");
    // Pola CLI `skills --agent claude-code`: isi di .agents/skills, symlink di .claude/skills.
    writeSkill(join(project, ".agents/skills/linked"), "---\nname: linked\ndescription: L\n---\n");
    mkdirSync(join(project, ".claude/skills"), { recursive: true });
    symlinkSync(join(project, ".agents/skills/linked"), join(project, ".claude/skills/linked"));
    writeSkill(join(project, ".claude/skills/plain"), "no frontmatter");
    writeSkill(join(global, "global-one"), "---\nname: global-one\n---\n");

    const skills = await listClaudeSkills(project, global);
    expect(skills.map((s) => [s.name, s.source, s.description])).toEqual([
      ["global-one", "global", null],
      ["linked", "project", "L"],
      ["plain", "project", null],
    ]);
    expect(skills[1]?.location).toBe(join(project, ".claude/skills/linked/SKILL.md"));
  });

  test("direktori tidak ada -> daftar kosong", async () => {
    expect(await listClaudeSkills("/nonexistent-kcg", "/nonexistent-kcg-global")).toEqual([]);
  });

  test("claudeGlobalSkillsDir menghormati CLAUDE_CONFIG_DIR", () => {
    expect(claudeGlobalSkillsDir({ CLAUDE_CONFIG_DIR: "/cfg" })).toBe("/cfg/skills");
    expect(claudeGlobalSkillsDir({})).toEndWith("/.claude/skills");
  });
});
