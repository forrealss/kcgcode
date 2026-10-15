/**
 * Harness e2e `createKcgServer` (bukan file test): agent palsu yang meniru
 * agent sungguhan (balasan mengalir lewat event), Skills_Registry palsu, dan
 * server nyata di atas store memori. Dipakai bersama `app-*.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore, type SessionStore } from "../../db";
import { createKcgServer, type KcgServer } from "../app";
import type { SkillsRegistry } from "../services/skills-registry";
import {
  type FakeAgentClient,
  type FakeBackend,
  makeFakeBackend,
  makeFakeClient,
  replyEvents,
} from "./fake-agent";

// ---------------------------------------------------------------------------
// Agent palsu e2e
// ---------------------------------------------------------------------------

export interface E2EClient extends FakeAgentClient {
  /**
   * Prompt berikutnya gagal diproses agent: alih-alih membalas, agent
   * memancarkan `session.execution.failed` (kegagalan diam-diam di model).
   */
  failNextPrompt: boolean;
}

/**
 * Meniru agent sungguhan: prompt diterima, balasan mengalir lewat event,
 * lalu `session.execution.succeeded` menutup turn.
 */
export function makeE2EClient(projectId: string): E2EClient {
  const client = makeFakeClient({
    createSessionResult: { ok: true, id: `ses_${projectId}` },
    mcpServers: [{ name: "context7", status: "connected", error: null }],
    skillList: [
      { name: "shadcn", description: "UI kit", location: "/x/SKILL.md", source: "project" },
    ],
  }) as E2EClient;
  client.failNextPrompt = false;
  client.onPrompt = (sessionID, text) => {
    queueMicrotask(() => {
      if (client.failNextPrompt) {
        client.failNextPrompt = false;
        client.emit({ type: "session.execution.started", data: { sessionID } });
        client.emit({
          type: "session.execution.failed",
          data: {
            sessionID,
            error: {
              type: "unknown",
              message:
                'TypeError: File URL host must be "localhost" or empty on linux\n    at SessionPrompt.resolveUserPart',
            },
          },
        });
        return;
      }
      for (const ev of replyEvents(sessionID, `msg_${projectId}`, `balasan: ${text}`)) {
        client.emit(ev);
      }
    });
  };
  return client;
}

export function makeE2EBackend(kind: "opencode" | "claude-code"): FakeBackend {
  return makeFakeBackend(kind, (projectId) => makeE2EClient(projectId));
}

/** Client e2e milik Project (undefined bila belum dibuat). */
export function e2eClient(backend: FakeBackend, projectId: string): E2EClient | undefined {
  return backend.clients.get(projectId) as E2EClient | undefined;
}

export async function waitFor(
  pred: () => boolean,
  timeoutMs = 3000,
  label = "kondisi",
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout menunggu ${label}`);
    await Bun.sleep(10);
  }
}

// ---------------------------------------------------------------------------
// Server e2e
// ---------------------------------------------------------------------------

/** Server e2e yang sedang berjalan beserta agent palsu & catatan panggilannya. */
export interface E2EServer {
  store: SessionStore;
  app: KcgServer;
  root: string;
  opencode: FakeBackend;
  claude: FakeBackend;
  /** Instalasi yang diminta ke Skills_Registry palsu: [cwd, source, skill]. */
  installCalls: [string, string, string][];
}

/**
 * Nyalakan server nyata (`Bun.serve` port 0) di atas store memori, backend
 * agent palsu, dan Skills_Registry palsu. Satu server dipakai bersama
 * seluruh test dalam satu file (`beforeAll` / `afterAll`).
 */
export function startE2EServer(): E2EServer {
  const installCalls: [string, string, string][] = [];
  const skillsRegistry: SkillsRegistry = {
    async search(q) {
      if (q.trim().length < 2) return { ok: false, error: "INVALID_SKILL_QUERY" };
      return {
        ok: true,
        data: [
          {
            id: "a/b/c",
            name: "c",
            source: "a/b",
            skillId: "c",
            installs: 3,
            url: "https://skills.sh/a/b/c",
          },
        ],
      };
    },
    async audit(source) {
      if (source === "bad") return { ok: false, error: "INVALID_SKILL_ID" };
      return { ok: true, data: { audits: null, overall: null } };
    },
    async install(cwd, source, skill, onLine) {
      installCalls.push([cwd, source, skill]);
      onLine?.(`installing ${skill}`);
      if (skill === "boom") return { ok: false, error: "SKILL_INSTALL_FAILED" };
      return { ok: true, data: { name: skill, path: `${cwd}/.agents/skills/${skill}` } };
    },
  };

  const store = openSessionStore(":memory:");
  const root = mkdtempSync(path.join(tmpdir(), "kcg-e2e2-"));
  mkdirSync(path.join(root, "proj"), { recursive: true });
  const opencode = makeE2EBackend("opencode");
  const claude = makeE2EBackend("claude-code");
  const app = createKcgServer({
    config: { sandboxRoot: root, configPath: "test" },
    store,
    opencode: opencode.backend,
    claude: claude.backend,
    uploadsRoot: path.join(root, "uploads"),
    port: 0,
    skillsRegistry,
  });
  return { store, app, root, opencode, claude, installCalls };
}

export async function stopE2EServer({ app, root }: E2EServer): Promise<void> {
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
