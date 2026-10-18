/**
 * Perakitan Preview: dev server per Project, listener proxy preview (origin
 * sendiri), overlay ke Session chat, dan server MCP `kcg_preview` untuk
 * agent — plus kait ke session-core (MCP & instruksi Claude Code, adopsi
 * dev server yang dijalankan agent).
 *
 * Dua tahap karena saling bergantung: opsi session-core dibutuhkan sebelum
 * core dibuat, sedangkan dev server/preview butuh core & kunci aplikasi.
 */

import type { SessionStore } from "../../db";
import type { AuthService } from "../services/auth";
import {
  AGENT_MCP_NAME,
  AGENT_MCP_PATH,
  AGENT_MCP_READONLY_TOOLS,
  AGENT_PREVIEW_INSTRUCTIONS,
  type AgentMcp,
  createAgentMcp,
} from "../services/preview/agent-mcp";
import { portsFromParts } from "../services/preview/agent-servers";
import { createDevServerManager, type DevServerManager } from "../services/preview/dev-servers";
import { resolveLaunchConfig } from "../services/preview/launch-config";
import type { PreviewBridge } from "../services/preview/overlay-api";
import { createPreviewServer, type PreviewServer } from "../services/preview/preview-server";
import { createScreenshotter, type Screenshotter } from "../services/preview/screenshot";
import { createPreviewSnapshots, type PreviewSnapshots } from "../services/preview/snapshots";
import { frpcLocalIp } from "../services/tunnel/frpc-config";
import type { SessionCore, SessionCoreOptions } from "./session-core";

export interface PreviewParts {
  devServers: DevServerManager;
  preview: PreviewServer;
  agentMcp: AgentMcp;
  screenshotter: Screenshotter;
  snapshots: PreviewSnapshots;
}

export interface PreviewWiring {
  /** Opsi session-core (dibaca saat runtime, setelah `start`). */
  coreOptions: Pick<
    SessionCoreOptions,
    "claudeExtraMcp" | "extraMcpServer" | "extraInstructions" | "onAgentParts" | "onTurnEnded"
  >;
  /** Port listener preview (null sebelum `start`). */
  previewPort(): number | null;
  start(deps: { core: SessionCore; auth: AuthService }): PreviewParts;
  /** Port nyata app utama setelah listen (port 0 di test). */
  setListenPort(port: number): void;
}

const LIVE_DEV_SERVERS = Symbol.for("kcg.preview.devServers");

/**
 * Port listener Preview: env KCG_PREVIEW_PORT, default port utama + 1
 * (port 0 di test -> acak). Bila terpakai, listener memilih port acak.
 */
function resolvePreviewPort(mainPort: number): number {
  const n = Number(process.env.KCG_PREVIEW_PORT);
  if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
  return mainPort === 0 || mainPort >= 65535 ? 0 : mainPort + 1;
}

/**
 * Overlay Preview -> Session chat: info Session, kirim pesan, dan langganan
 * event lewat gateway WebSocket yang sama dengan chat.
 */
function createPreviewBridge(store: SessionStore, core: SessionCore): PreviewBridge {
  return {
    session(projectId, sessionId) {
      const s = store.getSession(sessionId);
      if (!s.ok || s.data.projectId !== projectId) return null;
      return {
        id: s.data.id,
        title: s.data.title,
        status: s.data.status,
        turnActive: core.isTurnActive(sessionId),
      };
    },
    sendPrompt: (sessionId, text, images) =>
      core.sessionManager.sendFreeTextInput(sessionId, text, [], images),
    saveImage(sessionId, bytes, mime) {
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const saved = core.attachments.save(sessionId, `preview.${ext}`, mime, bytes);
      return saved.ok ? { ok: true, data: { id: saved.data.id } } : saved;
    },
    subscribe(sessionId, sub) {
      core.gateway.attach(sub, sessionId);
      return () => core.gateway.detach(sub);
    },
    getDraft: (sessionId) => core.gateway.getDraft(sessionId),
    setDraft: (sessionId, draft, origin) => core.gateway.setDraft(sessionId, draft, origin),
    readAttachment(sessionId, id) {
      const file = core.attachments.read(sessionId, id);
      return file.ok ? { bytes: file.data.bytes, mime: file.data.mime } : null;
    },
  };
}

export function createPreviewWiring(opts: {
  store: SessionStore;
  hostname: string;
  port: number;
}): PreviewWiring {
  const { store, hostname } = opts;
  let listenPort = opts.port;
  let parts: PreviewParts | null = null;
  // Agent berjalan di mesin ini: tuju app lewat loopback bila bind wildcard.
  const mcpHost = (() => {
    const ip = frpcLocalIp(hostname);
    return ip.includes(":") ? `[${ip}]` : ip;
  })();

  /** MCP `kcg_preview` untuk proses agent Project (token Bearer per Project). */
  function mcpServer(
    projectId: string,
  ): { name: string; url: string; headers: Record<string, string> } | null {
    if (!parts) return null;
    return {
      name: AGENT_MCP_NAME,
      url: `http://${mcpHost}:${listenPort}${AGENT_MCP_PATH}?project=${encodeURIComponent(projectId)}`,
      headers: { Authorization: `Bearer ${parts.agentMcp.tokenFor(projectId)}` },
    };
  }

  /** Dev server yang dijalankan agent sendiri -> adopsi agar bisa di-preview. */
  function adoptAgentServers(
    sessionId: string,
    messageParts: Parameters<typeof portsFromParts>[0],
  ) {
    if (!parts) return;
    const { devServers, preview } = parts;
    const ports = portsFromParts(messageParts).filter(
      (p) => p !== listenPort && p !== preview.port,
    );
    if (ports.length === 0) return;
    const s = store.getSession(sessionId);
    if (!s.ok) return;
    const projectId = s.data.projectId;
    const cur = devServers.status(projectId);
    if (cur?.phase === "starting" || cur?.phase === "running") return;
    void (async () => {
      for (const p of ports) if (await devServers.adopt(projectId, p)) return;
    })();
  }

  return {
    coreOptions: {
      claudeExtraMcp: (projectId) => {
        const server = mcpServer(projectId);
        if (!server) return null;
        return {
          servers: { [server.name]: { type: "http", url: server.url, headers: server.headers } },
          allowedTools: AGENT_MCP_READONLY_TOOLS,
        };
      },
      // opencode: `mcp.add` (memori service saja) sebelum setiap turn.
      extraMcpServer: (session) => mcpServer(session.projectId),
      // Instruksi per Session (bukan per direktori): Session opencode milik
      // pengguna di luar kcgcode tidak mendapatnya walau tool-nya terlihat.
      extraInstructions: () => (parts ? AGENT_PREVIEW_INSTRUCTIONS : null),
      onAgentParts: adoptAgentServers,
      onTurnEnded: (sessionId, outcome) => void parts?.snapshots.onTurnEnd(sessionId, outcome),
    },
    previewPort: () => parts?.preview.port ?? null,
    setListenPort(port) {
      listenPort = port;
    },
    start({ core, auth }) {
      let preview: PreviewServer | null = null;
      // `bun --hot`: hentikan dev server milik evaluasi modul sebelumnya agar
      // tidak jadi proses yatim yang memegang port.
      const live = globalThis as unknown as Record<symbol, DevServerManager | undefined>;
      void live[LIVE_DEV_SERVERS]?.shutdown();
      const devServers = createDevServerManager({
        // Status dev server -> sheet Preview di semua tab & overlay yang terbuka.
        onChange: (projectId, status) => {
          core.gateway.notifyPreviewStatus(projectId, status);
          preview?.serverChanged(projectId, status);
        },
      });
      const screenshotter = createScreenshotter();
      const previewServer = createPreviewServer({
        hostname,
        port: resolvePreviewPort(opts.port),
        devServers,
        isAuthorized: (token) => !auth.isProtected() || auth.authenticate(token) !== null,
        bridge: createPreviewBridge(store, core),
        screenshotter,
      });
      preview = previewServer;
      const snapshots = createPreviewSnapshots({
        devServers,
        screenshotter,
        projectOf: (sessionId) => {
          const s = store.getSession(sessionId);
          return s.ok ? s.data.projectId : null;
        },
        lastView: (projectId) => previewServer.lastView(projectId),
        save: (sessionId, bytes) => {
          const saved = core.attachments.save(sessionId, "preview.jpg", "image/jpeg", bytes);
          return saved.ok ? { ok: true, data: { id: saved.data.id } } : saved;
        },
        remove: (sessionId, id) => core.attachments.remove(sessionId, id),
        notify: (sessionId, snapshot) => core.gateway.notifyPreviewSnapshot(sessionId, snapshot),
      });
      live[LIVE_DEV_SERVERS] = devServers;
      const agentMcp = createAgentMcp({
        devServers,
        projectPath: (projectId) => {
          const p = core.projectManager.getProject(projectId);
          return p.ok ? p.data.path : null;
        },
        resolveConfig: resolveLaunchConfig,
      });
      parts = { devServers, preview: previewServer, agentMcp, screenshotter, snapshots };
      return parts;
    },
  };
}
