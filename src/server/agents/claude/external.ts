/**
 * Session Claude Code yang dibuat di luar KCG (`AgentClient.external`).
 *
 * Claude Desktop (tab Code) dan `claude` CLI menulis transcript ke
 * `~/.claude/projects/<cwd>/<id>.jsonl` — tempat yang sama dengan proses
 * `claude` milik KCG — sehingga Session-nya bisa dilanjutkan dengan `resume`
 * biasa. Modul ini hanya menyediakan daftar (judul Desktop bila ada, tanda
 * "sedang terbuka di tempat lain"), riwayat untuk timeline, dan fork.
 */
import type { Result } from "../../result";
import type { AgentClient, AgentExternalSession } from "../types";
import { historyFromTranscript } from "./history";
import type { ClaudeHostSessions } from "./host-sessions";
import type { ClaudeTranscripts } from "./sdk";

export interface ClaudeExternalDeps {
  cwd: string;
  transcripts: ClaudeTranscripts;
  host: ClaudeHostSessions;
}

/** Potong teks panjang untuk cuplikan daftar. */
function snippet(text: string | undefined, max = 160): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function createClaudeExternal(
  deps: ClaudeExternalDeps,
): NonNullable<AgentClient["external"]> {
  const { cwd, transcripts, host } = deps;

  async function list(): Promise<Result<AgentExternalSession[]>> {
    try {
      const [infos, running, desktop] = await Promise.all([
        transcripts.list(cwd),
        host.running().catch(() => new Map()),
        host.desktop().catch(() => new Map()),
      ]);
      const data = infos
        .map((info): AgentExternalSession => {
          const proc = running.get(info.sessionId);
          const title =
            desktop.get(info.sessionId)?.title ??
            proc?.name ??
            snippet(info.customTitle ?? info.summary, 120) ??
            "Untitled session";
          const source =
            proc?.entrypoint ?? (desktop.has(info.sessionId) ? "claude-desktop" : undefined);
          return {
            id: info.sessionId,
            title,
            ...(snippet(info.firstPrompt) ? { firstPrompt: snippet(info.firstPrompt) } : {}),
            ...(info.createdAt !== undefined ? { createdAt: info.createdAt } : {}),
            updatedAt: info.lastModified,
            ...(info.gitBranch ? { gitBranch: info.gitBranch } : {}),
            openElsewhere: proc !== undefined,
            ...(source ? { source } : {}),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `CC_EXTERNAL_LIST_FAILED: ${(e as Error).message}` };
    }
  }

  return {
    list,
    async history(sessionID) {
      try {
        const info = (await transcripts.list(cwd)).find((s) => s.sessionId === sessionID);
        if (!info) return { ok: false, error: "SESSION_NOT_FOUND" };
        const messages = await transcripts.messages(sessionID, cwd);
        return {
          ok: true,
          data: historyFromTranscript(messages, info.createdAt ?? info.lastModified),
        };
      } catch (e) {
        return { ok: false, error: `CC_EXTERNAL_HISTORY_FAILED: ${(e as Error).message}` };
      }
    },
    async fork(sessionID, title) {
      try {
        return { ok: true, data: { id: await transcripts.fork(sessionID, cwd, title) } };
      } catch (e) {
        return { ok: false, error: `CC_FORK_FAILED: ${(e as Error).message}` };
      }
    },
  };
}
