/**
 * Konteks kerja Session untuk panel kanan: info git, task list, perubahan
 * file, status MCP, pemakaian konteks, dan status compact.
 */
import type { SessionContext } from "../../../types";
import type { Result } from "../../result";
import { EMPTY_GIT_INFO, readGitInfo } from "../git-info";
import type { SessionRuntime } from "./runtime";

export function createSessionContextReader(rt: SessionRuntime) {
  const { store, compacting } = rt;

  /**
   * Konteks kerja Session (panel kanan). Ketiga sumbernya independen dan
   * SELALU dibaca bersamaan; kegagalan salah satu tidak menggagalkan yang
   * lain (mis. repo bukan git -> `git` kosong, task list tetap tampil).
   * Tanpa client agent yang siap -> hanya info git (agent tidak dinyalakan
   * hanya untuk mengisi panel).
   */
  return async function sessionContext(sessionId: string): Promise<Result<SessionContext>> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const cwd = cur.data.cwd;
    const client = rt.clientFor(cur.data.agentType, cur.data.projectId);
    // Task list disimpan per Session agent (opencode `ses_...` / UUID Claude).
    const remoteId = cur.data.ocSessionId ?? sessionId;

    const [git, todos, changes, mcp, usage] = await Promise.all([
      readGitInfo(cwd).catch(() => EMPTY_GIT_INFO),
      client ? client.session.todos(remoteId) : Promise.resolve(null),
      client ? client.vcs.status() : Promise.resolve(null),
      client ? client.mcp.list() : Promise.resolve(null),
      client ? client.session.contextUsage(remoteId) : Promise.resolve(null),
    ]);

    return {
      ok: true,
      data: {
        git,
        todos: todos?.ok ? todos.data : [],
        changes: changes?.ok ? changes.data : [],
        mcp: mcp?.ok ? mcp.data : [],
        usage: usage?.ok ? usage.data : null,
        compacting: compacting.has(sessionId),
        /** Panel perlu tahu data tool belum tersedia vs memang kosong. */
        live: client !== undefined,
      },
    };
  };
}
