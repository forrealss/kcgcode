/**
 * Inti domain Session: Project_Manager, backend agent, lampiran, Skills
 * Registry + job instalasi, notifikasi, Session_Manager, dan
 * WebSocket_Gateway — dirakit dengan hook saling-silang (Session_Manager
 * memancarkan event ke gateway & notifikasi).
 *
 * `reconcileOnStartup()` dijalankan di sini sebelum server menerima koneksi
 * (Requirement 2.4).
 */

import path from "node:path";
import type { SessionStore } from "../../db";
import type { MessagePart, Session } from "../../types";
import { createClaudeBackend } from "../agents/claude/backend";
import type { ClaudeExtraMcp } from "../agents/claude/client";
import { createOpencodeBackend } from "../agents/opencode/backend";
import { checkOpencodeVersion, OPENCODE_UPGRADE_REQUIRED } from "../agents/opencode/version";
import type { AgentBackend } from "../agents/types";
import { type AttachmentManager, createAttachmentManager } from "../services/attachments";
import { createNotificationService, type NotificationService } from "../services/notifications";
import { createProjectManager, type ProjectManager } from "../services/project-manager";
import {
  createSessionManager,
  type SessionManager,
  type SessionManagerOptions,
} from "../services/session-manager";
import { createSkillInstallJobs, type SkillInstallJobs } from "../services/skill-install-jobs";
import {
  createSkillsRegistry,
  isValidSkillId,
  isValidSource,
  type SkillsRegistry,
} from "../services/skills-registry";
import { createTurnDiffs, type TurnDiffs } from "../services/turn-diffs";
import type { TurnOutcome } from "../services/turn-stream";
import { createWebSocketGateway, type WebSocketGateway } from "../services/websocket-gateway";

export interface SessionCoreOptions {
  store: SessionStore;
  sandboxRoot: string;
  uploadsRoot: string;
  /** Backend opencode terinjeksi (test); bila ada, cek versi CLI dilewati. */
  opencode?: AgentBackend;
  claude?: AgentBackend;
  skillsRegistry?: SkillsRegistry;
  pushFetch?: typeof fetch;
  /** MCP kcgcode untuk proses Claude Code per Project (Preview). */
  claudeExtraMcp?: (projectId: string) => ClaudeExtraMcp | null;
  /** Instruksi sistem tambahan per Session (Preview). */
  extraInstructions?: (session: Session) => string | null;
  /** MCP HTTP kcgcode per Session (didaftarkan ke opencode sebelum turn). */
  extraMcpServer?: SessionManagerOptions["extraMcpServer"];
  /** Part pesan agent (final & streaming) — mis. deteksi dev server agent. */
  onAgentParts?: (sessionId: string, parts: MessagePart[]) => void;
  /** Turn agent selesai (mis. snapshot preview). */
  onTurnEnded?: (sessionId: string, outcome: TurnOutcome) => void;
}

export interface SessionCore {
  projectManager: ProjectManager;
  attachments: AttachmentManager;
  skillsRegistry: SkillsRegistry;
  skillInstalls: SkillInstallJobs;
  notifications: NotificationService;
  sessionManager: SessionManager;
  gateway: WebSocketGateway;
  /** Model sedang merespon di Session ini (overlay Preview butuh status awal). */
  isTurnActive(sessionId: string): boolean;
  /** File yang diubah agent per turn (snapshot git). */
  turnDiffs: TurnDiffs;
}

/**
 * Peringatan dini bila CLI opencode user masih v1 (tidak didukung lagi):
 * tanpa ini user baru tahu saat membuka Session opencode. Tidak menahan
 * start-up.
 */
function warnOutdatedOpencode(): void {
  void checkOpencodeVersion().then((res) => {
    if (!res.ok && res.error.startsWith(OPENCODE_UPGRADE_REQUIRED)) {
      const version = res.error.split(":")[1]?.trim() ?? "1.x";
      console.warn(
        `[kcg-code] opencode ${version} terdeteksi — KCG Code butuh opencode 2.x. ` +
          "Jalankan `opencode upgrade` lalu restart KCG Code untuk memakai agent opencode.",
      );
    }
  });
}

export function createSessionCore(opts: SessionCoreOptions): SessionCore {
  const { store } = opts;
  const projectManager = createProjectManager(opts.sandboxRoot, store);
  // Lapisan agent (acuan opencode v2): service opencode milik user dipakai
  // bersama seluruh Project; proses `claude` di-spawn saat Session Claude
  // Code menerima prompt.
  const backends = {
    opencode: opts.opencode ?? createOpencodeBackend(),
    "claude-code": opts.claude ?? createClaudeBackend({ extraMcp: opts.claudeExtraMcp }),
  };
  // Backend yang diinjeksi (test) dilewati.
  if (!opts.opencode) warnOutdatedOpencode();
  const attachments: AttachmentManager = createAttachmentManager(opts.uploadsRoot);

  // Skills_Registry & job instalasi dibuat lebih dulu: session manager
  // memberi tahu job instalasi saat refresh skill tertunda selesai. Callback
  // `refreshSkills` baru dipanggil saat instalasi berjalan (setelah init).
  const skillsRegistry = opts.skillsRegistry ?? createSkillsRegistry();
  const skillInstalls = createSkillInstallJobs({
    registry: skillsRegistry,
    refreshSkills: (projectId, agentType) => sessionManager.refreshSkills(projectId, agentType),
    validate: (source, skill) => isValidSource(source) && isValidSkillId(skill),
  });

  let gateway: WebSocketGateway;
  const activeTurns = new Set<string>();
  // Ringkasan perubahan per turn di samping folder lampiran (`<data>/turn-diffs`).
  const turnDiffs = createTurnDiffs({
    dir: path.join(path.dirname(opts.uploadsRoot), "turn-diffs"),
    onDiff: (diff) => gateway.notifyTurnDiff(diff.sessionId, diff),
  });
  // Notifikasi agent: kartu izin/pertanyaan & turn selesai -> tab terbuka
  // (WS `notify`) lalu Web Push ke perangkat yang tidak sedang membuka app.
  const notifications = createNotificationService({
    store,
    broadcast: (n) => gateway.notifyAgent(n),
    fetchFn: opts.pushFetch,
  });
  const sessionManager = createSessionManager({
    store,
    backends,
    attachments,
    extraInstructions: opts.extraInstructions,
    extraMcpServer: opts.extraMcpServer,
    onMessage: (message) => {
      if (message.role === "assistant") {
        opts.onAgentParts?.(message.sessionId, message.parts);
        turnDiffs.noteMessage(message.sessionId, message.id);
      }
      gateway.notifyMessage(message.sessionId, message);
    },
    onMessagePart: (sessionId, messageId, part) => {
      opts.onAgentParts?.(sessionId, [part]);
      turnDiffs.noteMessage(sessionId, messageId);
      gateway.notifyMessagePart(sessionId, messageId, part);
    },
    onMessagePartDelta: (sessionId, messageId, partId, field, delta) =>
      gateway.notifyMessagePartDelta(sessionId, messageId, partId, field, delta),
    onPrompt: (prompt) => {
      gateway.notifyPrompt(prompt.sessionId, prompt);
      notifications.promptAsked(prompt);
    },
    // Kartu kembar yang ikut terjawab lewat fan-out grup: kirim notif
    // `prompt_resolved` agar hilang dari UI tanpa menunggu reattach.
    onPromptResolved: (sessionId, promptId) => gateway.notifyPromptResolved(sessionId, promptId),
    onStatusChange: (sessionId, status) => gateway.notifySessionStatus(sessionId, status),
    // Judul hasil generate opencode -> daftar Session di Client terbarui live.
    onTitleChange: (sessionId, title) => gateway.notifySessionTitle(sessionId, title),
    onPermissionModeChange: (sessionId, mode) =>
      gateway.notifySessionPermissionMode(sessionId, mode),
    onCompactionChange: (sessionId, compacting) =>
      gateway.notifySessionCompaction(sessionId, compacting),
    onDeleted: (sessionId) => {
      turnDiffs.removeSession(sessionId);
      gateway.notifySessionDeleted(sessionId);
    },
    onError: (sessionId, message) => gateway.notifyError(sessionId, "AGENT_ERROR", message),
    // Turn mulai/selesai -> Client tahu kapan model merespon (tombol stop).
    onTurnChange: (sessionId, active) => {
      if (active) {
        activeTurns.add(sessionId);
        // Snapshot working tree sebelum agent mengubah apa pun.
        const s = store.getSession(sessionId);
        if (s.ok) turnDiffs.turnStarted(sessionId, s.data.cwd);
      } else {
        activeTurns.delete(sessionId);
        void turnDiffs.turnEnded(sessionId);
      }
      gateway.notifyTurnActive(sessionId, active);
    },
    onTurnEnd: (sessionId, outcome) => {
      notifications.turnEnded(sessionId, outcome);
      opts.onTurnEnded?.(sessionId, outcome);
    },
    // Refresh skill tertunda berjalan otomatis setelah chat selesai -> perbarui
    // notifikasi instalasi terkait ("aktif sekarang").
    onSkillsRefreshed: (projectId) => skillInstalls.markRefreshed(projectId),
  });
  gateway = createWebSocketGateway({
    store,
    sessionManager,
    onNotifyAck: (id, endpoint) => notifications.ack(id, endpoint),
  });

  // Requirement 2.4: tandai Session "running" tanpa proses sebelum menerima koneksi.
  sessionManager.reconcileOnStartup();

  return {
    projectManager,
    attachments,
    skillsRegistry,
    skillInstalls,
    notifications,
    sessionManager,
    gateway,
    isTurnActive: (sessionId) => activeTurns.has(sessionId),
    turnDiffs,
  };
}
