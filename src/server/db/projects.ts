/**
 * Repository Projects. Berinteraksi dengan tabel `sessions` hanya untuk
 * penjagaan referensial `deleteProject` (membaca, tidak menulis).
 */
import type { Database } from "bun:sqlite";
import type { Project, Session } from "../../types";
import type { Result, SimpleResult } from "../result";
import { errResult, mapProject, mapSession, type ProjectRow, type SessionRow } from "./rows";

export function createProjectRepo(db: Database) {
  const q = {
    insertProject: db.query(
      "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
    ),
    getProjectById: db.query("SELECT * FROM projects WHERE id = ?"),
    getProjectByName: db.query("SELECT * FROM projects WHERE name = ?"),
    getProjectByPath: db.query("SELECT * FROM projects WHERE path = ?"),
    listProjects: db.query("SELECT * FROM projects ORDER BY created_at ASC, name ASC"),
    listProjectSessions: db.query(
      "SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at ASC, id ASC",
    ),
    deleteProjectRow: db.query("DELETE FROM projects WHERE id = ?"),
  };

  return {
    insertProject(project: Project): Result<Project> {
      try {
        q.insertProject.run(project.id, project.name, project.path, project.createdAt);
        return { ok: true, data: project };
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("projects.name")) return errResult("NAME_TAKEN");
        if (msg.includes("projects.path")) return errResult("PATH_TAKEN");
        return errResult(`PROJECT_WRITE_FAILED: ${msg}`);
      }
    },

    getProjectById(id: string): Result<Project> {
      const row = q.getProjectById.get(id) as ProjectRow | null;
      if (!row) return errResult("PROJECT_NOT_FOUND");
      return { ok: true, data: mapProject(row) };
    },

    getProjectByName(name: string): Result<Project> {
      const row = q.getProjectByName.get(name) as ProjectRow | null;
      if (!row) return errResult("PROJECT_NOT_FOUND");
      return { ok: true, data: mapProject(row) };
    },

    getProjectByPath(filePath: string): Result<Project> {
      const row = q.getProjectByPath.get(filePath) as ProjectRow | null;
      if (!row) return errResult("PROJECT_NOT_FOUND");
      return { ok: true, data: mapProject(row) };
    },

    listProjects(): Project[] {
      return (q.listProjects.all() as ProjectRow[]).map(mapProject);
    },

    /** Session milik satu Project (dipakai sebelum menghapus Project). */
    listProjectSessions(projectId: string): Session[] {
      return (q.listProjectSessions.all(projectId) as SessionRow[]).map(mapSession);
    },

    /**
     * Hapus baris Project. Session milik Project harus sudah dihapus lebih
     * dulu: `sessions.project_id` punya foreign key ke `projects(id)`, dan
     * menghapus Session lewat jalur ini akan melewatkan pembersihan sesi
     * remote opencode + lampiran gambarnya.
     */
    deleteProject(projectId: string): SimpleResult {
      try {
        const existing = q.getProjectById.get(projectId) as ProjectRow | null;
        if (!existing) return errResult("PROJECT_NOT_FOUND");
        const sessions = q.listProjectSessions.all(projectId) as SessionRow[];
        if (sessions.length > 0) return errResult("PROJECT_HAS_SESSIONS");
        q.deleteProjectRow.run(projectId);
        return { ok: true };
      } catch (e) {
        return errResult(`PROJECT_DELETE_FAILED: ${(e as Error).message}`);
      }
    },
  };
}

export type ProjectRepo = ReturnType<typeof createProjectRepo>;
