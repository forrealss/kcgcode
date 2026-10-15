/**
 * Backend Claude Code — tanpa proses/port: hanya client in-process per
 * Project yang mengelola proses `claude` per Session.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AgentBackend } from "../types";
import { type ClaudeClient, createClaudeClient } from "./client";

export interface ClaudeBackendOptions {
  clientFactory?: (cwd: string) => ClaudeClient;
}

function isDirectory(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function createClaudeBackend(opts: ClaudeBackendOptions = {}): AgentBackend {
  const factory = opts.clientFactory ?? ((cwd: string) => createClaudeClient(cwd));
  const clients = new Map<string, { client: ClaudeClient; cwd: string }>();

  async function release(projectId: string): Promise<void> {
    const cur = clients.get(projectId);
    if (!cur) return;
    clients.delete(projectId);
    await cur.client.close();
  }

  return {
    kind: "claude-code",
    async ensure(projectId, directory) {
      const cur = clients.get(projectId);
      if (cur && cur.cwd === directory) return { ok: true, data: cur.client };
      if (!isDirectory(directory)) return { ok: false, error: "PROJECT_DIR_NOT_FOUND" };
      if (cur) await cur.client.close();
      const client = factory(path.resolve(directory));
      clients.set(projectId, { client, cwd: directory });
      return { ok: true, data: client };
    },
    get: (projectId) => clients.get(projectId)?.client,
    release,
    async shutdown() {
      await Promise.all([...clients.keys()].map((id) => release(id)));
    },
    // Tidak ada proses server yang bisa hilang; crash proses `claude` per
    // Session dilaporkan sebagai `session.execution.failed`.
    onLost() {},
  };
}
