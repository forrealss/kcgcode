/**
 * Panggilan REST perubahan per turn & viewer file Project. Error tetap
 * `ApiError` dari `apiFetch`.
 */
import { apiFetch } from "@/lib/api";
import type { ProjectFileContent, TurnDiff } from "@/types";

const enc = encodeURIComponent;

export async function getTurnDiffs(sessionId: string): Promise<TurnDiff[]> {
  const res = await apiFetch(`/api/sessions/${enc(sessionId)}/changes`);
  return ((await res.json()) as { diffs: TurnDiff[] }).diffs;
}

/** Unified diff satu file pada perubahan `diffId`. */
export async function getFileDiff(
  sessionId: string,
  diffId: string,
  path: string,
): Promise<string> {
  const res = await apiFetch(
    `/api/sessions/${enc(sessionId)}/changes/${enc(diffId)}/diff?path=${enc(path)}`,
  );
  return ((await res.json()) as { diff: string }).diff;
}

export async function getProjectFile(projectId: string, path: string): Promise<ProjectFileContent> {
  const res = await apiFetch(`/api/projects/${enc(projectId)}/file?path=${enc(path)}`);
  return ((await res.json()) as { file: ProjectFileContent }).file;
}

/** URL gambar Project untuk `<img>` (cookie sesi ikut terkirim). */
export function projectImageUrl(projectId: string, path: string): string {
  return `/api/projects/${enc(projectId)}/file?path=${enc(path)}&raw=1`;
}

/** Bahasa highlight dari ekstensi file. */
export function languageForPath(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (/^dockerfile$/i.test(name)) return "docker";
  if (/^makefile$/i.test(name)) return "make";
  const ext = name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
  const map: Record<string, string> = {
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "tsx",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    json: "json",
    jsonc: "jsonc",
    md: "markdown",
    mdx: "markdown",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    swift: "swift",
    dart: "dart",
    lua: "lua",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    ini: "ini",
    xml: "xml",
    svg: "xml",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    vue: "vue",
    svelte: "svelte",
    sh: "shellscript",
    bash: "shellscript",
    zsh: "shellscript",
    ps1: "powershell",
    diff: "diff",
    patch: "diff",
  };
  return map[ext] ?? null;
}
