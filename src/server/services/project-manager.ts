/**
 * Project_Manager & Folder_Browser.
 * Sesuai `design.md` — `project-manager.ts`.
 *
 * `listDirectory` dan `createProject` selalu memvalidasi path lewat
 * `sandbox.ts` sebelum operasi filesystem apa pun, dan memakai `db.ts`
 * untuk persistensi.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import type { SessionStore } from "../../db";
import type { Project } from "../../types";
import type { Result } from "../result";
import { resolveWithinSandbox } from "./sandbox";

export interface ProjectManager {
  listDirectory(relativePath: string): Result<{ entries: string[] }>;
  createProject(name: string, relativePath: string): Result<Project>;
  listProjects(): Project[];
}

/** Peta hasil validasi sandbox -> pesan error publik. */
function sandboxError(reason: string): string {
  return reason === "outside_sandbox" ? "PATH_OUTSIDE_SANDBOX" : "INVALID_PATH_CHARS";
}

/**
 * Membuat instance Project_Manager terikat pada `sandboxRoot` dan `store`.
 */
export function createProjectManager(sandboxRoot: string, store: SessionStore): ProjectManager {
  function listDirectory(relativePath: string): Result<{ entries: string[] }> {
    const res = resolveWithinSandbox(sandboxRoot, relativePath);
    if (!res.ok) return { ok: false, error: sandboxError(res.reason) };

    const realPath = res.realPath;
    let dirents: import("node:fs").Dirent[];
    try {
      dirents = readdirSync(realPath, { withFileTypes: true });
    } catch {
      return { ok: false, error: "PATH_NOT_FOUND" };
    }

    // Hanya sub-direktori (Requirement 10.2). Symlink tidak diikuti sehingga
    // entri dari luar sandbox tidak pernah bocor ke hasil listing.
    const entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    return { ok: true, data: { entries } };
  }

  function createProject(name: string, relativePath: string): Result<Project> {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "NAME_REQUIRED" };

    const byName = store.getProjectByName(trimmed);
    if (byName.ok) return { ok: false, error: "NAME_TAKEN" };

    const res = resolveWithinSandbox(sandboxRoot, relativePath);
    if (!res.ok) return { ok: false, error: sandboxError(res.reason) };
    const realPath = res.realPath;

    const byPath = store.getProjectByPath(realPath);
    if (byPath.ok) return { ok: false, error: "PATH_TAKEN" };

    try {
      mkdirSync(realPath, { recursive: true });
    } catch {
      return { ok: false, error: "MKDIR_FAILED" };
    }

    const project: Project = {
      id: randomUUID(),
      name: trimmed,
      path: realPath,
      createdAt: Date.now(),
    };
    const inserted = store.insertProject(project);
    if (!inserted.ok) return inserted;
    return { ok: true, data: project };
  }

  function listProjects(): Project[] {
    return store.listProjects();
  }

  return { listDirectory, createProject, listProjects };
}
