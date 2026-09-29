/**
 * Helper tampilan katalog skill (skills.sh) di halaman Skills — logika murni
 * tanpa DOM, dipisah agar dapat diuji `bun test`.
 */
import type { SkillInfo } from "@/server/services/opencode-client";
import type { AuditStatus, RegistrySkill } from "@/server/services/skills-registry";
import type { Project } from "@/types";

/** Kunci localStorage Project terakhir yang dipilih di halaman Skills. */
export const LAST_SKILLS_PROJECT_KEY = "kcg-skills-project";

/** Saran kata kunci saat kolom cari masih kosong (tab Browse). */
export const SEARCH_SUGGESTIONS = [
  "react",
  "nextjs",
  "testing",
  "typescript",
  "python",
  "design",
  "docs",
  "git",
] as const;

/**
 * Project terpilih di halaman Skills: `?project=` (dari sidebar) menang, lalu
 * pilihan terakhir yang diingat, lalu satu-satunya Project bila hanya ada
 * satu. Id yang tidak dikenal (Project terhapus) dilewati.
 */
export function resolveSkillsProject(
  projects: readonly Project[],
  urlId: string | null,
  storedId: string | null,
): Project | null {
  for (const id of [urlId, storedId]) {
    if (id === null) continue;
    const hit = projects.find((p) => p.id === id);
    if (hit) return hit;
  }
  return projects.length === 1 ? (projects[0] ?? null) : null;
}

/** Owner GitHub dari `owner/repo`; `null` untuk sumber well-known (domain). */
export function githubOwner(source: string): string | null {
  const [owner, repo, ...rest] = source.split("/");
  if (!owner || !repo || rest.length > 0) return null;
  return owner;
}

/**
 * Skill terpasang yang relevan untuk halaman Skills: tanpa bawaan opencode,
 * Project dulu lalu global, difilter kata kunci (nama / deskripsi).
 */
export function visibleInstalledSkills(skills: readonly SkillInfo[], query: string): SkillInfo[] {
  const q = query.trim().toLowerCase();
  const match = (s: SkillInfo) =>
    q === "" || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
  return [
    ...skills.filter((s) => s.source === "project" && match(s)),
    ...skills.filter((s) => s.source === "global" && match(s)),
  ];
}

/** Jumlah install ringkas: 950, 1.2K, 752K, 1.3M. */
export function formatInstalls(n: number): string {
  if (n < 1000) return String(n);
  const fmt = (v: number, unit: string) => {
    const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
    return `${s}${unit}`;
  };
  if (n < 1_000_000) return fmt(n / 1000, "K");
  return fmt(n / 1_000_000, "M");
}

/**
 * Nama skill yang sudah terpasang di Project (sumber `project`). Skill global
 * sengaja tidak dihitung: instalasi di halaman ini memasang ke folder Project,
 * jadi skill global bernama sama tetap boleh dipasang per Project.
 */
export function installedProjectSkillNames(skills: readonly SkillInfo[]): Set<string> {
  return new Set(skills.filter((s) => s.source === "project").map((s) => s.name.toLowerCase()));
}

/** Apakah skill katalog sudah terpasang di Project (cocokkan nama folder / nama). */
export function isInstalled(skill: RegistrySkill, installed: ReadonlySet<string>): boolean {
  return installed.has(skill.skillId.toLowerCase()) || installed.has(skill.name.toLowerCase());
}

/** Label & gaya ringkasan audit keamanan. */
export const AUDIT_LABEL: Record<AuditStatus, string> = {
  pass: "Passed",
  warn: "Review",
  fail: "Flagged",
};

export const AUDIT_BADGE_CLASS: Record<AuditStatus, string> = {
  pass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  fail: "bg-destructive/10 text-destructive",
};
