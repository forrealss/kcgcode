/**
 * Daftar skill Claude Code — dibaca langsung dari disk.
 *
 * Claude Code tidak punya server headless untuk ditanya (beda dengan
 * `GET /skill` opencode), jadi skill dipindai dari lokasi yang sama dengan
 * yang dibaca CLI `claude`:
 * - Project : `<project>/.claude/skills/<nama>/SKILL.md`
 * - Global  : `<CLAUDE_CONFIG_DIR | ~/.claude>/skills/<nama>/SKILL.md`
 *
 * CLI `skills` (`--agent claude-code`) memasang ke `.claude/skills/` berupa
 * symlink ke `.agents/skills/`, jadi symlink diikuti. Skill dari plugin
 * Claude Code tidak ikut (tidak dipasang lewat halaman Skills).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { SkillInfo, SkillSource } from "../../types";

/** Direktori skill global Claude Code untuk `env` tertentu. */
export function claudeGlobalSkillsDir(env: Record<string, string | undefined>): string {
  // `HOME` dari env proses `claude` (sama dengan yang dipakai CLI-nya).
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || join(env.HOME?.trim() || homedir(), ".claude");
  return join(configDir, "skills");
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Ambil `name` & `description` dari frontmatter YAML SKILL.md. Cukup untuk
 * bentuk yang umum: nilai satu baris (boleh berkutip) atau blok `>` / `|`
 * yang baris lanjutannya menjorok. Murni — diuji.
 */
export function parseSkillFrontmatter(text: string): {
  name: string | null;
  description: string | null;
} {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { name: null, description: null };
  const fields: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const key = m[1];
    let value = m[2] ?? "";
    if (value === "" || /^[>|][+-]?$/.test(value.trim())) {
      // Blok berlapis: kumpulkan baris menjorok berikutnya.
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? "")) {
        i++;
        parts.push((lines[i] ?? "").trim());
      }
      value = parts.join(" ");
    }
    fields[key] = unquote(value);
  }
  const str = (v: string | undefined) => (v && v !== "" ? v : null);
  return { name: str(fields.name), description: str(fields.description) };
}

async function scanDir(root: string, source: SkillSource): Promise<SkillInfo[]> {
  const out: SkillInfo[] = [];
  const glob = new Bun.Glob("*/SKILL.md");
  try {
    for await (const rel of glob.scan({ cwd: root, followSymlinks: true, onlyFiles: true })) {
      const location = join(root, rel);
      // Bun.Glob mengembalikan `\` sebagai pemisah di Windows.
      const dirName = rel.split(/[\\/]/)[0] ?? rel;
      let meta: ReturnType<typeof parseSkillFrontmatter> = { name: null, description: null };
      try {
        meta = parseSkillFrontmatter(await Bun.file(location).text());
      } catch {
        // SKILL.md tak terbaca (symlink rusak, izin) — tetap tampil pakai nama folder.
      }
      out.push({ name: meta.name ?? dirName, description: meta.description, location, source });
    }
  } catch {
    // Direktori belum ada — tidak ada skill.
  }
  return out;
}

/**
 * Skill Claude Code untuk sebuah Project (Project + global), terurut nama.
 * Nama yang sama di dua lokasi tetap tampil keduanya (dibedakan `source`),
 * sama seperti daftar opencode.
 */
export async function listClaudeSkills(
  projectPath: string,
  globalDir: string,
): Promise<SkillInfo[]> {
  const [project, global] = await Promise.all([
    scanDir(join(projectPath, ".claude", "skills"), "project"),
    scanDir(globalDir, "global"),
  ]);
  return [...project, ...global].sort((a, b) => a.name.localeCompare(b.name));
}
