/**
 * Session_Manager — lifecycle Session & orkestrasi agent.
 *
 * Berbicara dengan agent HANYA lewat lapisan agent KCG (`src/server/agents`)
 * yang mengacu ke opencode SDK v2 — opencode v2 dan Claude Code sama-sama
 * dibungkus adapter dengan kontrak yang sama:
 * - `createSession` memastikan client agent untuk Project (`AgentBackend.ensure`)
 *   lalu membuat Session di agent (`session.create`).
 * - Output berupa `SessionMessage` terstruktur yang disimpan di `messages` dan
 *   diteruskan via hook `onMessage`; part dirakit dari event agent oleh
 *   `AgentEventProjector`.
 * - Prompt dikirim lewat `session.prompt` (tanpa menunggu) dan turn ditutup
 *   oleh `session.execution.succeeded|failed|interrupted` Session akar.
 * - Interactive_Prompt berasal dari event terstruktur: `permission.asked`
 *   (-> confirmation) dan `form.created` (-> menu question).
 * - Sub-agent dijalankan agent sebagai Session terpisah dengan `parentID`;
 *   `session.created` memetakan child tersebut ke Session lokal induk agar
 *   prompt izin & streaming-nya tidak terbuang.
 * - `resolvePrompt` menjawab lewat `permission.reply` / `form.reply|cancel`.
 *
 * File ini hanya komposisi; implementasinya ada di `./sessions/`: kontrak
 * publik (`types`), state bersama & helper store/hook (`runtime`),
 * sambungan proyektor event (`projector-wiring`), client agent per Project
 * (`agent-clients`), pemetaan id Session agent (`agent-session-map`),
 * lifecycle Session (`lifecycle`), pilihan per Session (`settings`),
 * konteks panel kanan (`session-context`), kirim pesan + antrean per Session
 * (`send-message`), startup/shutdown & agent hilang (`startup-shutdown`),
 * refresh skill tertunda (`skill-refresh`), operasi daftar Project
 * (`project-queries`), input prompt (`prompt-input`), dan jawaban kartu
 * prompt (`prompt-resolver`).
 *
 * Prinsip error: fungsi publik mengembalikan `{ ok: true, data } |
 * { ok: false, error }`, dan Session berstatus `running` hanya setelah
 * berhasil dibuat di agent.
 */
import type { SimpleResult } from "../result";
import { createSessionLifecycle } from "./sessions/lifecycle";
import { createProjectQueries } from "./sessions/project-queries";
import { createPromptResolver } from "./sessions/prompt-resolver";
import { createSessionRuntime } from "./sessions/runtime";
import { createMessageSender } from "./sessions/send-message";
import { createSessionContextReader } from "./sessions/session-context";
import { createSessionSettings } from "./sessions/settings";
import { createStartupShutdown } from "./sessions/startup-shutdown";
import type { SessionManager, SessionManagerOptions } from "./sessions/types";

export {
  type CreateSessionRequest,
  type CreateSessionResult,
  isEffortId,
  MAX_FREE_TEXT_LENGTH,
  type SessionManager,
  type SessionManagerOptions,
  SHUTDOWN_BUDGET_MS,
  SUPPORTED_AGENT_TYPES,
  TURN_IDLE_TIMEOUT_MS,
} from "./sessions/types";
export type { SimpleResult };

/**
 * Membuat instance Session_Manager terikat pada `store` dan `backends`.
 * `backends` (lapisan agent), `now`, dan timer dapat diinjeksi untuk test.
 *
 * Komposisi saja: state bersama dibuat sekali di `createSessionRuntime` lalu
 * diteruskan eksplisit ke tiap modul operasi.
 */
export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  const rt = createSessionRuntime(opts);
  const { store, skills } = rt;

  const queries = createProjectQueries(rt.projectClient);
  const resolvePrompt = createPromptResolver({
    store,
    projector: rt.projector,
    clientFor: rt.clientFor,
    now: rt.now,
    onPromptResolved: opts.onPromptResolved,
  });

  const lifecycle = createSessionLifecycle(rt);
  const settings = createSessionSettings({ rt, listCapabilities: queries.listCapabilities });
  const sessionContext = createSessionContextReader(rt);
  const sendFreeTextInput = createMessageSender(rt);
  const { reconcileOnStartup, shutdown, watchAgentLoss } = createStartupShutdown(rt);

  // Saat agent hilang tak terduga, tandai Session project tsb `crashed`.
  watchAgentLoss();

  return {
    createSession: lifecycle.createSession,
    listSessions: () => store.listSessions(),
    getSession: (sessionId) => store.getSession(sessionId),
    stopSession: lifecycle.stopSession,
    interruptSession: lifecycle.interruptSession,
    resumeSession: lifecycle.resumeSession,
    deleteSession: lifecycle.deleteSession,
    releaseProject: lifecycle.releaseProject,
    ...queries,
    refreshSkills: (projectId, agentType) => skills.refresh(projectId, agentType),
    hasPendingSkillRefresh: (projectId) => skills.hasPending(projectId),
    setSessionModel: settings.setSessionModel,
    setSessionEffort: settings.setSessionEffort,
    setSessionAgent: settings.setSessionAgent,
    setSessionPermissionMode: settings.setSessionPermissionMode,
    sessionContext,
    sendFreeTextInput,
    resolvePrompt,
    reconcileOnStartup,
    shutdown,
  };
}
