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
 * Prinsip error: fungsi publik mengembalikan `{ ok: true, data } |
 * { ok: false, error }`, dan Session berstatus `running` hanya setelah
 * berhasil dibuat di agent.
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionStore } from "../../db";
import { modelFacingMime } from "../../lib/attachments";
import type {
  AgentOption,
  AgentType,
  InteractivePrompt,
  McpServerInfo,
  MessagePart,
  ModelOption,
  PromptResponse,
  Session,
  SessionContext,
  SessionMessage,
  SessionModel,
  SessionStatus,
  SkillInfo,
} from "../../types";
import {
  AGENT_REQUEST_GONE,
  type AgentBackend,
  type AgentClient,
  type AgentPromptFile,
} from "../agents/types";
import type { Result, SimpleResult } from "../result";
import { AgentEventProjector } from "./agent-projector";
import type { AttachmentManager } from "./attachments";
import { EMPTY_GIT_INFO, readGitInfo } from "./git-info";
import {
  deriveSessionTitle,
  formAnswerFromLabels,
  friendlySendError,
  isPlaceholderTitle,
  labelsFromResponse,
  permissionGroupKey,
} from "./session-events";
import { type TurnOutcome, TurnStream } from "./turn-stream";

export const MAX_FREE_TEXT_LENGTH = 10000;
/**
 * Batas IDLE turn (jaring pengaman bila akhir eksekusi tak kunjung datang).
 * Bukan batas total: timer di-reset tiap ada tanda hidup opencode (part
 * streaming, pesan assistant, status busy/retry) — turn panjang yang sehat
 * (reasoning panjang, tool lambat, sub-agent, retry provider) tidak dipotong;
 * hanya keheningan TOTAL selama durasi ini yang memicu fail.
 */
export const TURN_IDLE_TIMEOUT_MS = 300_000;
export const SHUTDOWN_BUDGET_MS = 5000;

/**
 * Tipe CLI_Agent yang dikenal. Tipe hanya aktif bila backend-nya diinjeksi
 * (lihat `SessionManagerOptions.backends`).
 */
export const SUPPORTED_AGENT_TYPES: readonly AgentType[] = ["opencode", "claude-code"];

export interface CreateSessionRequest {
  agentType: AgentType;
  projectId: string;
  /** Model pilihan user; null/undefined = model default agent. */
  model?: SessionModel | null;
  /** Agent (mode) pilihan user; null/undefined = default agent. */
  agent?: string | null;
}

export type CreateSessionResult = { ok: true; session: Session } | { ok: false; error: string };

export type { SimpleResult };

/** Default jeda refresh skill tertunda setelah turn terakhir selesai. */
const SKILL_REFRESH_DELAY_MS = 1500;

export interface SessionManagerOptions {
  store: SessionStore;
  /**
   * Backend agent per tipe CLI_Agent (lapisan `src/server/agents`). Tipe
   * tanpa backend -> Session tipe itu ditolak (`UNSUPPORTED_AGENT_TYPE`).
   */
  backends: Partial<Record<AgentType, AgentBackend>>;
  /**
   * Penyimpanan lampiran gambar (upload dari perangkat). Bila tidak diisi,
   * fitur gambar dinonaktifkan — pesan dengan `images` ditolak.
   */
  attachments?: AttachmentManager;
  now?: () => number;
  shutdownBudgetMs?: number;
  /**
   * Batas idle turn (ms) — jaring pengaman bila `session.idle` tak kunjung
   * datang. Di-reset tiap ada tanda hidup; bukan batas total turn.
   */
  turnIdleTimeoutMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Hook pesan baru — disambungkan ke WebSocket_Gateway. */
  onMessage?: (message: SessionMessage) => void;
  /**
   * Hook part pesan yang sedang di-stream (SSE `message.part.updated`).
   * `messageId` = id pesan assistant di opencode yang sedang dibangun.
   */
  onMessagePart?: (sessionId: string, messageId: string, part: MessagePart) => void;
  /**
   * Hook potongan teks streaming (SSE `message.part.delta`) — token model
   * tiba lewat event ini; lihat `TurnStream.acceptDelta`.
   */
  onMessagePartDelta?: (
    sessionId: string,
    messageId: string,
    partId: string,
    field: string,
    delta: string,
  ) => void;
  /** Hook Interactive_Prompt baru — disambungkan ke WebSocket_Gateway. */
  onPrompt?: (prompt: InteractivePrompt) => void;
  /**
   * Hook prompt kembar yang ikut ter-resolve lewat fan-out jawaban kartu
   * grup (lihat `permissionGroupKey`) — agar kartu kembar hilang dari UI
   * client lain tanpa menunggu reattach.
   */
  onPromptResolved?: (sessionId: string, promptId: string) => void;
  /** Hook perubahan status Session — disambungkan ke WebSocket_Gateway. */
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
  /**
   * Hook judul Session baru hasil generate opencode (SSE `session.updated`
   * setelah prompt pertama) — disambungkan ke WebSocket_Gateway agar daftar
   * Session di Client ikut terbarui tanpa reload.
   */
  onTitleChange?: (sessionId: string, title: string) => void;
  /** Hook Session dihapus permanen — disambungkan ke WebSocket_Gateway. */
  onDeleted?: (sessionId: string) => void;
  /** Hook error asinkron (mis. balasan model gagal) — disambungkan ke gateway. */
  onError?: (sessionId: string, message: string) => void;
  /**
   * Hook perubahan status turn — `true` saat model mulai merespon (turn
   * streaming aktif), `false` saat turn selesai/dibatalkan. Disambungkan ke
   * gateway agar Client tahu kapan tombol stop (interrupt) perlu tampil.
   */
  onTurnChange?: (sessionId: string, active: boolean) => void;
  /**
   * Turn berakhir dengan sendirinya (`done` = agent selesai menjawab,
   * `failed` = error terminal / timeout / server mati) — bukan saat user
   * stop/interrupt. Disambungkan ke layanan notifikasi.
   */
  onTurnEnd?: (sessionId: string, outcome: TurnOutcome) => void;
  /**
   * Refresh skill yang sempat tertunda (turn aktif saat skill dipasang) baru
   * saja dijalankan otomatis untuk Project ini.
   */
  onSkillsRefreshed?: (projectId: string) => void;
  /** Jeda refresh skill tertunda setelah turn terakhir selesai (ms). */
  skillRefreshDelayMs?: number;
}

export interface SessionManager {
  createSession(req: CreateSessionRequest): Promise<CreateSessionResult>;
  listSessions(): Session[];
  getSession(sessionId: string): Result<Session>;
  stopSession(sessionId: string): SimpleResult;
  /**
   * Hentikan balasan model yang sedang berlangsung (interrupt ala opencode):
   * turn remote di-abort, parts yang sudah ter-stream disimpan, tapi Session
   * TETAP `running` — user bisa langsung kirim pesan baru tanpa Start ulang.
   */
  interruptSession(sessionId: string): SimpleResult;
  /**
   * Hapus Session permanen: pastikan server headless opencode hidup (spawn
   * ulang bila perlu) lalu hapus session remote di sana (beserta riwayat
   * pesannya), kemudian baris Session di Session_Store.
   */
  deleteSession(sessionId: string): Promise<SimpleResult>;
  /**
   * Menghidupkan kembali Session yang `stopped`/`crashed` — memakai ocSessionId
   * lama bila masih dikenal server headless, memakai sesi remote baru bila
   * tidak, lalu status kembali `running`.
   */
  resumeSession(sessionId: string): Promise<SimpleResult>;
  /**
   * Lepaskan seluruh sumber daya milik satu Project sebelum Project dihapus:
   * hapus tiap Session-nya (termasuk sesi remote opencode & lampiran) lalu
   * hentikan server headless Project. Gagal pada salah satu Session ->
   * error diteruskan tanpa melanjutkan, agar tidak ada sesi yatim.
   */
  releaseProject(projectId: string): Promise<SimpleResult>;
  /** Daftar model yang tersedia pada server headless milik Project. */
  listModels(projectId: string, agentType?: AgentType): Promise<Result<ModelOption[]>>;
  /**
   * Daftar agent (mode) opencode milik Project — primary/all saja, siap
   * ditampilkan di pemilih mode composer.
   */
  listAgents(projectId: string, agentType?: AgentType): Promise<Result<AgentOption[]>>;
  /** Status MCP server yang terkonfigurasi untuk Project. */
  listMcp(projectId: string, agentType?: AgentType): Promise<Result<McpServerInfo[]>>;
  /** Skill yang terdaftar untuk Project (global, folder Project, bawaan). */
  listSkills(projectId: string, agentType?: AgentType): Promise<Result<SkillInfo[]>>;
  /**
   * Muat ulang daftar skill server headless Project setelah skill dipasang.
   * Bila ada turn aktif di Project, refresh ditunda (`refreshed: false`) agar
   * chat yang berjalan tidak terganggu — lalu dijalankan OTOMATIS begitu
   * seluruh turn di Project selesai (`onSkillsRefreshed`). Server yang belum
   * hidup tidak perlu di-refresh. Claude Code selalu langsung `refreshed`.
   */
  refreshSkills(projectId: string, agentType?: AgentType): Promise<Result<{ refreshed: boolean }>>;
  /** Project dengan refresh skill tertunda (menunggu turn selesai). */
  hasPendingSkillRefresh(projectId: string): boolean;
  /** Cari file project untuk autocomplete `@file` di composer. */
  findFiles(projectId: string, query: string, agentType?: AgentType): Promise<Result<string[]>>;
  /**
   * Konteks kerja Session untuk panel kanan: perubahan file di worktree,
   * cabang git, dan task list (`todowrite`) agent.
   */
  sessionContext(sessionId: string): Promise<Result<SessionContext>>;
  /** Ganti model pilihan Session (`null` = kembali ke default opencode). */
  setSessionModel(sessionId: string, model: SessionModel | null): SimpleResult;
  /**
   * Ganti agent (mode) pilihan Session — `build`, `plan`, atau agent kustom
   * (`null` = default opencode). Berlaku pada prompt berikutnya.
   */
  setSessionAgent(sessionId: string, agent: string | null): SimpleResult;
  /**
   * Kirim input bebas. `files` = path relatif project (`@file`); `images` =
   * id lampiran di Attachment_Store (gambar upload dari perangkat).
   */
  sendFreeTextInput(
    sessionId: string,
    text: string,
    files?: string[],
    images?: string[],
  ): Promise<SimpleResult>;
  resolvePrompt(
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): Promise<SimpleResult>;
  reconcileOnStartup(): void;
  shutdown(): Promise<void>;
}

/**
 * Membuat instance Session_Manager terikat pada `store` dan `backends`.
 * `backends` (lapisan agent), `now`, dan timer dapat diinjeksi untuk test.
 */
export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  const store = opts.store;
  const backends = opts.backends;

  /** Backend milik tipe CLI_Agent (undefined = tipe tidak aktif). */
  function backendFor(agentType: AgentType): AgentBackend | undefined {
    return backends[agentType];
  }

  /** Client agent Project yang sudah siap (tanpa membuat baru). */
  function clientFor(agentType: AgentType, projectId: string): AgentClient | undefined {
    return backendFor(agentType)?.get(projectId);
  }

  /** Kunci subscription/exit per backend + Project (keduanya bisa hidup). */
  function backendKey(agentType: AgentType, projectId: string): string {
    return `${agentType}:${projectId}`;
  }
  const attachments = opts.attachments;
  const now = opts.now ?? Date.now;
  const shutdownBudgetMs = opts.shutdownBudgetMs ?? SHUTDOWN_BUDGET_MS;
  const turnIdleTimeoutMs = opts.turnIdleTimeoutMs ?? TURN_IDLE_TIMEOUT_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const onMessage = opts.onMessage;
  const onPrompt = opts.onPrompt;
  const onPromptResolved = opts.onPromptResolved;
  const onStatusChange = opts.onStatusChange;
  const onTitleChange = opts.onTitleChange;
  const onDeleted = opts.onDeleted;
  const onError = opts.onError;

  /**
   * Project yang refresh skill-nya tertunda karena ada turn aktif saat skill
   * dipasang. Dijalankan otomatis begitu seluruh turn di Project selesai.
   */
  const pendingSkillRefresh = new Set<string>();
  /** Timer refresh tertunda per Project (dibatalkan bila turn baru dimulai). */
  const skillRefreshTimers = new Map<string, unknown>();
  /** Jeda setelah turn terakhir selesai sebelum dispose (biarkan event penutup tuntas). */
  const skillRefreshDelayMs = opts.skillRefreshDelayMs ?? SKILL_REFRESH_DELAY_MS;
  const onSkillsRefreshed = opts.onSkillsRefreshed;

  const onTurnChange = (sessionId: string, active: boolean): void => {
    opts.onTurnChange?.(sessionId, active);
    const projectId = store.getSession(sessionId);
    if (!projectId.ok || !pendingSkillRefresh.has(projectId.data.projectId)) return;
    if (active) {
      // Turn baru dimulai sebelum timer jalan -> tunda lagi.
      cancelScheduledSkillRefresh(projectId.data.projectId);
    } else {
      scheduleSkillRefresh(projectId.data.projectId);
    }
  };

  /**
   * Pemetaan id Session agent -> id Session lokal.
   *
   * Selain Session yang dibuat lewat `session.create`, map ini juga memuat
   * child session yang dibuat agent sendiri saat model memanggil sub-agent.
   * Child session punya `sessionID` sendiri di event, sehingga tanpa pemetaan
   * ini event-nya (termasuk `permission.asked`) akan terbuang.
   */
  const ocToSession = new Map<string, string>();
  /** Kebalikan `ocToSession`: id Session lokal -> seluruh id Session agent miliknya. */
  const sessionOcIds = new Map<string, Set<string>>();
  /** Langganan event per backend+Project (lihat `backendKey`) beserta client-nya. */
  const activeSubscriptions = new Map<string, { client: AgentClient; unsubscribe: () => void }>();
  /** Serialisasi kirim pesan per Session agar turn tidak tumpang tindih. */
  const inflight = new Map<string, Promise<void>>();
  /** Backend+Project yang sudah diproses saat agent-nya hilang (hindari duplikasi). */
  const exitNotified = new Set<string>();
  const onMessagePart = opts.onMessagePart;
  const onMessagePartDelta = opts.onMessagePartDelta;

  /** State turn streaming per Session (finish/discard/fail + timer idle). */
  const turns = new TurnStream({
    store,
    now,
    onMessage,
    onMessagePart,
    onMessagePartDelta,
    onError,
    onTurnChange,
    onTurnEnd: opts.onTurnEnd,
    // Turn menunggu keputusan user (kartu permission/question pending) bukan
    // keheningan — timer idle ditunda sampai kartu dijawab atau turn ditutup.
    shouldFireIdle: (sessionId) => store.listPendingPrompts(sessionId).length === 0,
    setTimeoutFn,
    clearTimeoutFn,
  });

  function updateStatus(sessionId: string, status: SessionStatus, changedAt: number): void {
    const res = store.updateSessionStatus(sessionId, status, changedAt);
    if (res.ok) onStatusChange?.(sessionId, status);
  }

  function updatePromptResolved(promptId: string): void {
    store.updatePromptStatus(promptId, "resolved", now());
  }

  /** Catat pemetaan id Session agent -> Session lokal (juga untuk cleanup). */
  function mapOcSession(ocSessionId: string, sessionId: string): void {
    ocToSession.set(ocSessionId, sessionId);
    let owned = sessionOcIds.get(sessionId);
    if (!owned) {
      owned = new Set<string>();
      sessionOcIds.set(sessionId, owned);
    }
    owned.add(ocSessionId);
  }

  /** Lepas seluruh id Session agent (induk + child) milik satu Session lokal. */
  function unmapOcSessions(sessionId: string): void {
    const owned = sessionOcIds.get(sessionId);
    if (!owned) return;
    for (const ocId of owned) ocToSession.delete(ocId);
    sessionOcIds.delete(sessionId);
  }

  /** Proyeksi event agent ke part pesan, kartu prompt, dan judul Session. */
  const projector = new AgentEventProjector({
    turns,
    now,
    resolve: (agentSessionID) => ocToSession.get(agentSessionID),
    // Hanya Session AKAR yang menandai akhir turn & judul percakapan —
    // sub-agent selesai lebih dulu dari induknya.
    isRoot: (sessionId, agentSessionID) => {
      const cur = store.getSession(sessionId);
      return cur.ok && cur.data.ocSessionId === agentSessionID;
    },
    mapChild: (childID, sessionId) => mapOcSession(childID, sessionId),
    setTitle: (sessionId, title) => {
      const cur = store.getSession(sessionId);
      if (!cur.ok || cur.data.title === title) return;
      if (!store.updateSessionTitle(sessionId, title).ok) return;
      onTitleChange?.(sessionId, title);
    },
    insertPrompt: (prompt) => store.insertPrompt(prompt).ok,
    onPrompt,
    onError,
  });

  /**
   * Pastikan client agent Project siap dan event-nya disubscribe. Client
   * baru (backend membuat ulang client, mis. direktori Project berubah)
   * menggantikan langganan lama.
   */
  async function ensureClient(
    projectId: string,
    projectPath: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<AgentClient>> {
    const backend = backendFor(agentType);
    if (!backend) return { ok: false, error: "UNSUPPORTED_AGENT_TYPE" };
    const res = await backend.ensure(projectId, projectPath);
    if (!res.ok) return res;
    const client = res.data;
    const key = backendKey(agentType, projectId);
    const sub = activeSubscriptions.get(key);
    if (sub?.client !== client) {
      sub?.unsubscribe();
      const unsubscribe = client.event.subscribe((ev) => projector.handle(ev));
      activeSubscriptions.set(key, { client, unsubscribe });
    }
    // Client siap — izinkan event kehilangan berikutnya diproses.
    exitNotified.delete(key);
    return { ok: true, data: client };
  }

  function enqueue(sessionId: string, task: () => Promise<void>): void {
    const prev = inflight.get(sessionId) ?? Promise.resolve();
    const next = prev.then(task).finally(() => {
      if (inflight.get(sessionId) === next) inflight.delete(sessionId);
    });
    inflight.set(sessionId, next);
  }

  async function createSession(req: CreateSessionRequest): Promise<CreateSessionResult> {
    // (1) tipe CLI_Agent didukung (Requirement 1.3)
    if (!SUPPORTED_AGENT_TYPES.includes(req.agentType) || !backendFor(req.agentType)) {
      return { ok: false, error: "UNSUPPORTED_AGENT_TYPE" };
    }
    // (2) Project ada di Session_Store (Requirement 10.10)
    const projectRes = store.getProjectById(req.projectId);
    if (!projectRes.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const project = projectRes.data;
    // (3) direktori kerja Project masih ada di filesystem (Requirement 10.11)
    let dirExists = false;
    try {
      dirExists = existsSync(project.path) && statSync(project.path).isDirectory();
    } catch {
      dirExists = false;
    }
    if (!dirExists) return { ok: false, error: "PROJECT_DIR_NOT_FOUND" };

    // (4) pastikan client agent untuk Project siap
    const clientRes = await ensureClient(project.id, project.path, req.agentType);
    if (!clientRes.ok) return { ok: false, error: clientRes.error };
    const client = clientRes.data;

    // (5) validasi model pilihan terhadap daftar model agent (Req: pilih
    //     model). `null` = pakai default agent. Daftar model gagal diambil ->
    //     ditolak agar Session tidak lahir dengan model mati.
    const model: SessionModel | null = req.model ?? null;
    if (model) {
      const models = await client.model.list();
      if (!models.ok) return { ok: false, error: models.error };
      const known = models.data.some(
        (m) => m.providerID === model.providerID && m.modelID === model.modelID,
      );
      if (!known) return { ok: false, error: "MODEL_NOT_FOUND" };
    }

    // (6) buat Session di agent — TANPA judul, agar agent meng-generate judul
    //     dari prompt pertama (lihat lib/session-title.ts).
    const created = await client.session.create();
    if (!created.ok) return { ok: false, error: created.error };

    const sessionId = randomUUID();
    const createdAt = now();
    // Judul placeholder tidak disimpan. Judul datang dari `session.renamed`;
    // sementara itu `sendFreeTextInput` memberi judul turunan prompt pertama.
    const remoteTitle =
      typeof created.data.title === "string" && !isPlaceholderTitle(created.data.title)
        ? created.data.title
        : null;
    const session: Session = {
      id: sessionId,
      projectId: project.id,
      agentType: req.agentType,
      cwd: project.path,
      status: "running",
      ocSessionId: created.data.id,
      title: remoteTitle,
      model,
      agent: req.agent ?? null,
      createdAt,
      updatedAt: createdAt,
    };
    const ins = store.insertSession(session);
    if (!ins.ok) {
      // Hapus session remote agar tidak jadi yatim bila persistensi gagal.
      void client.session.remove(created.data.id);
      return ins;
    }
    mapOcSession(created.data.id, sessionId);
    return { ok: true, session };
  }

  function listSessions(): Session[] {
    return store.listSessions();
  }

  function getSession(sessionId: string): Result<Session> {
    return store.getSession(sessionId);
  }

  function stopSession(sessionId: string): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status !== "running") return { ok: false, error: "SESSION_NOT_RUNNING" };
    // Abort turn berjalan (best-effort, tidak menunggu).
    if (cur.data.ocSessionId) {
      void clientFor(cur.data.agentType, cur.data.projectId)?.session.interrupt(
        cur.data.ocSessionId,
      );
    }
    // Simpan parts yang sudah terkumpul sebelum Session ditutup.
    turns.finish(sessionId);
    // Lepas induk + seluruh child sub-agent milik Session ini.
    unmapOcSessions(sessionId);
    updateStatus(sessionId, "stopped", now());
    return { ok: true };
  }

  /**
   * Hentikan balasan model yang sedang berlangsung:
   * - Turn remote di-interrupt (best-effort, tidak menunggu).
   * - Parts yang sudah ter-stream DIBUANG (tidak disimpan) — user membatalkan
   *   balasan, sehingga respon parsial tidak boleh muncul di riwayat/UI.
   * - Session TETAP `running` dan pemetaan event dipertahankan — user bisa
   *   langsung mengirim pesan baru tanpa Start ulang.
   * Idempoten: tanpa turn aktif tidak ada yang berubah (tetap `ok`).
   */
  function interruptSession(sessionId: string): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    // Interrupt turn berjalan (best-effort, tidak menunggu).
    if (cur.data.status === "running" && cur.data.ocSessionId) {
      void clientFor(cur.data.agentType, cur.data.projectId)?.session.interrupt(
        cur.data.ocSessionId,
      );
    }
    // Buang turn parsial (tidak disimpan) + broadcast turn tidak aktif.
    turns.discard(sessionId);
    return { ok: true };
  }

  /**
   * Menghidupkan kembali Session yang `stopped`/`crashed` dengan riwayat
   * percakapan utuh:
   *
   * 1. Client agent Project di-ensure (koneksi/proses dibuat ulang bila
   *    perlu) — storage Session agent bertahan di disk, sehingga id Session
   *    lama biasanya masih dikenal.
   * 2. id Session agent diverifikasi (`session.get`). Bila masih ada, dipakai
   *    lagi (riwayat agent tetap nyambung). Bila tidak, dibuat Session agent
   *    baru dan `oc_session_id` di DB diperbarui — pesan lama di
   *    Session_Store tidak tersentuh.
   * 3. Pemetaan event diaktifkan kembali lalu status -> `running`.
   */
  async function resumeSession(sessionId: string): Promise<SimpleResult> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status === "running") return { ok: false, error: "SESSION_ALREADY_RUNNING" };
    const project = store.getProjectById(cur.data.projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };

    // (1) Pastikan client agent Project siap.
    const clientRes = await ensureClient(project.data.id, project.data.path, cur.data.agentType);
    if (!clientRes.ok) return { ok: false, error: clientRes.error };
    const client = clientRes.data;

    // (2) Verifikasi id Session agent lama; bila tidak dikenal -> Session baru.
    let ocSessionId = cur.data.ocSessionId;
    if (ocSessionId) {
      const remote = await client.session.get(ocSessionId);
      if (remote.ok) {
        mapOcSession(ocSessionId, sessionId);
      } else {
        ocSessionId = null;
      }
    }
    if (!ocSessionId) {
      // Session agent baru (yang lama hilang). Tanpa judul: bila Session belum
      // punya judul, agent akan meng-generate-nya dari prompt berikutnya.
      const created = await client.session.create();
      if (!created.ok) return { ok: false, error: created.error };
      ocSessionId = created.data.id;
      mapOcSession(ocSessionId, sessionId);
      const upd = store.updateSessionOcId(sessionId, ocSessionId);
      if (!upd.ok) return { ok: false, error: upd.error };
    }

    // (3) Status kembali running.
    updateStatus(sessionId, "running", now());
    return { ok: true };
  }

  /**
   * Lepaskan seluruh sumber daya milik satu Project — dipakai rute
   * `DELETE /api/projects/:id` sebelum baris Project dihapus:
   *
   * 1. Setiap Session milik Project dihapus lewat `deleteSession` sehingga
   *    Session agent, lampiran gambar, dan baris anaknya ikut bersih.
   *    Kegagalan menghentikan proses (error diteruskan) supaya tidak ada
   *    Session agent yatim — user bisa mencoba lagi.
   * 2. Client agent Project dilepas.
   */
  async function releaseProject(projectId: string): Promise<SimpleResult> {
    if (!store.getProjectById(projectId).ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    for (const session of store.listProjectSessions(projectId)) {
      const res = await deleteSession(session.id);
      if (!res.ok) return res;
    }
    for (const agentType of SUPPORTED_AGENT_TYPES) {
      await backendFor(agentType)?.release(projectId);
      // Langganan event ikut dilepas — client-nya sudah tidak dipakai.
      const key = backendKey(agentType, projectId);
      activeSubscriptions.get(key)?.unsubscribe();
      activeSubscriptions.delete(key);
      exitNotified.delete(key);
    }
    return { ok: true };
  }

  /** Client agent Project (dibuat bila perlu) untuk operasi baca daftar. */
  async function projectClient(
    projectId: string,
    agentType: AgentType,
  ): Promise<Result<AgentClient>> {
    const project = store.getProjectById(projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    return ensureClient(project.data.id, project.data.path, agentType);
  }

  /** Daftar model yang tersedia untuk Project (config agent di direktori Project). */
  async function listModels(
    projectId: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<ModelOption[]>> {
    const client = await projectClient(projectId, agentType);
    return client.ok ? client.data.model.list() : client;
  }

  /** Daftar agent (mode) untuk Project — agent kustom user ikut masuk. */
  async function listAgents(
    projectId: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<AgentOption[]>> {
    const client = await projectClient(projectId, agentType);
    return client.ok ? client.data.agent.list() : client;
  }

  /** Status MCP server Project. */
  async function listMcp(
    projectId: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<McpServerInfo[]>> {
    const client = await projectClient(projectId, agentType);
    return client.ok ? client.data.mcp.list() : client;
  }

  /**
   * Skill yang terdaftar untuk Project. Skill di dalam folder Project
   * ditandai `project` sehingga UI dapat membedakannya dari skill global.
   */
  async function listSkills(
    projectId: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<SkillInfo[]>> {
    const client = await projectClient(projectId, agentType);
    return client.ok ? client.data.skill.list() : client;
  }

  function projectBusy(projectId: string): boolean {
    return store.listSessions().some((s) => s.projectId === projectId && turns.has(s.id));
  }

  function cancelScheduledSkillRefresh(projectId: string): void {
    const t = skillRefreshTimers.get(projectId);
    if (t !== undefined) {
      clearTimeoutFn(t);
      skillRefreshTimers.delete(projectId);
    }
  }

  /** Jadwalkan refresh tertunda bila Project sudah tidak punya turn aktif. */
  function scheduleSkillRefresh(projectId: string): void {
    if (projectBusy(projectId)) return;
    cancelScheduledSkillRefresh(projectId);
    const handle = setTimeoutFn(() => {
      skillRefreshTimers.delete(projectId);
      void runPendingSkillRefresh(projectId);
    }, skillRefreshDelayMs);
    skillRefreshTimers.set(projectId, handle);
  }

  async function runPendingSkillRefresh(projectId: string): Promise<void> {
    if (!pendingSkillRefresh.has(projectId)) return;
    // Turn baru sempat dimulai -> tunggu turn berikutnya selesai.
    if (projectBusy(projectId)) return;
    const client = clientFor("opencode", projectId);
    if (!client) {
      // Client belum/tidak lagi dipakai -> skill terbaca saat dibuat lagi.
      pendingSkillRefresh.delete(projectId);
      onSkillsRefreshed?.(projectId);
      return;
    }
    const res = await client.location.reload();
    if (!res.ok) {
      // Tetap tertunda; dicoba lagi setelah turn berikutnya selesai.
      console.warn(`[kcg-code] refresh skill tertunda Project ${projectId} gagal:`, res.error);
      return;
    }
    pendingSkillRefresh.delete(projectId);
    onSkillsRefreshed?.(projectId);
  }

  async function refreshSkills(
    projectId: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<{ refreshed: boolean }>> {
    const project = store.getProjectById(projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const client = clientFor(agentType, projectId);
    // Client belum dibuat -> skill terbaca saat client dibuat nanti.
    if (!client) {
      if (agentType === "opencode") pendingSkillRefresh.delete(projectId);
      return { ok: true, data: { refreshed: true } };
    }
    // Agent yang memuat skill langsung dari disk (Claude Code: tiap proses
    // `claude` baru) tidak punya cache yang perlu ditunggu.
    if (!client.capabilities.skillReload) {
      await client.location.reload();
      return { ok: true, data: { refreshed: true } };
    }
    if (projectBusy(projectId)) {
      pendingSkillRefresh.add(projectId);
      return { ok: true, data: { refreshed: false } };
    }
    cancelScheduledSkillRefresh(projectId);
    const res = await client.location.reload();
    if (!res.ok) {
      console.warn(`[kcg-code] refresh skill Project ${projectId} gagal:`, res.error);
      // Coba lagi otomatis setelah turn berikutnya selesai.
      pendingSkillRefresh.add(projectId);
      return { ok: true, data: { refreshed: false } };
    }
    pendingSkillRefresh.delete(projectId);
    return { ok: true, data: { refreshed: true } };
  }

  function hasPendingSkillRefresh(projectId: string): boolean {
    return pendingSkillRefresh.has(projectId);
  }

  /**
   * Konteks kerja Session (panel kanan). Ketiga sumbernya independen dan
   * SELALU dibaca bersamaan; kegagalan salah satu tidak menggagalkan yang
   * lain (mis. repo bukan git -> `git` kosong, task list tetap tampil).
   * Tanpa client agent yang siap -> hanya info git (agent tidak dinyalakan
   * hanya untuk mengisi panel).
   */
  async function sessionContext(sessionId: string): Promise<Result<SessionContext>> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const cwd = cur.data.cwd;
    const client = clientFor(cur.data.agentType, cur.data.projectId);
    // Task list disimpan per Session agent (opencode `ses_...` / UUID Claude).
    const remoteId = cur.data.ocSessionId ?? sessionId;

    const [git, todos, changes, mcp] = await Promise.all([
      readGitInfo(cwd).catch(() => EMPTY_GIT_INFO),
      client ? client.session.todos(remoteId) : Promise.resolve(null),
      client ? client.vcs.status() : Promise.resolve(null),
      client ? client.mcp.list() : Promise.resolve(null),
    ]);

    return {
      ok: true,
      data: {
        git,
        todos: todos?.ok ? todos.data : [],
        changes: changes?.ok ? changes.data : [],
        mcp: mcp?.ok ? mcp.data : [],
        /** Panel perlu tahu data tool belum tersedia vs memang kosong. */
        live: client !== undefined,
      },
    };
  }

  /**
   * Cari file di Project untuk autocomplete `@file` — index pencarian milik
   * agent. `query` kosong juga valid (mengembalikan daftar awal).
   */
  async function findFiles(
    projectId: string,
    query: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<string[]>> {
    const client = await projectClient(projectId, agentType);
    return client.ok ? client.data.file.find(query) : client;
  }

  /**
   * Ganti model pilihan Session. Berlaku untuk prompt berikutnya (model
   * diterapkan ke agent sebelum tiap prompt), jadi tidak perlu restart.
   */
  function setSessionModel(sessionId: string, model: SessionModel | null): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const upd = store.updateSessionModel(sessionId, model);
    return upd.ok ? { ok: true } : { ok: false, error: upd.error };
  }

  /**
   * Ganti agent (mode) pilihan Session. Berlaku untuk prompt berikutnya
   * (agent diterapkan sebelum tiap prompt).
   */
  function setSessionAgent(sessionId: string, agent: string | null): SimpleResult {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (agent !== null && agent.trim() === "") return { ok: false, error: "INVALID_AGENT" };
    const upd = store.updateSessionAgent(sessionId, agent);
    return upd.ok ? { ok: true } : { ok: false, error: upd.error };
  }

  /**
   * Hapus Session permanen:
   *
   * 1. Turn yang sedang stream difinalisasi & pemetaan event dilepas.
   * 2. Pastikan client agent Project siap lalu `session.remove`: data Session
   *    (termasuk seluruh pesan) ikut dihapus di sisi agent. Penghapusan
   *    remote bersifat wajib: bila agent tidak bisa dihubungi atau menolak
   *    hapus, error diteruskan dan data lokal TIDAK dihapus — supaya tidak
   *    ada Session agent yang jadi yatim (bisa dicoba lagi kemudian).
   * 3. Baris Session + seluruh baris anaknya dihapus dari Session_Store.
   */
  async function deleteSession(sessionId: string): Promise<SimpleResult> {
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };

    turns.finish(sessionId);
    // Bila masih running, hentikan turn remote agar model berhenti dieksekusi.
    if (cur.data.status === "running" && cur.data.ocSessionId) {
      void clientFor(cur.data.agentType, cur.data.projectId)?.session.interrupt(
        cur.data.ocSessionId,
      );
    }
    unmapOcSessions(sessionId);

    // (2) Hapus di agent — wajib.
    const ocSessionId = cur.data.ocSessionId;
    if (ocSessionId) {
      let client = clientFor(cur.data.agentType, cur.data.projectId);
      if (!client) {
        const res = await projectClient(cur.data.projectId, cur.data.agentType);
        if (!res.ok) return { ok: false, error: res.error };
        client = res.data;
      }
      const remote = await client.session.remove(ocSessionId);
      if (!remote.ok) return { ok: false, error: remote.error };
    }

    // (3) Hapus lokal (transaksional: messages, prompts, history, session).
    const res = store.deleteSession(sessionId);
    if (res.ok) {
      // Lampiran gambar milik Session ikut dibersihkan (best effort).
      attachments?.removeSession(sessionId);
      onDeleted?.(sessionId);
    }
    return res;
  }

  async function sendFreeTextInput(
    sessionId: string,
    text: string,
    files: string[] = [],
    images: string[] = [],
  ): Promise<SimpleResult> {
    // Pesan berupa teks bebas dan/atau gambar: teks kosong diizinkan bila ada
    // gambar terlampir (mis. kirim gambar saja), selainnya wajib non-kosong.
    const hasText = text.trim().length > 0;
    const hasImages = images.length > 0;
    if (!hasText && !hasImages) {
      return { ok: false, error: "TEXT_EMPTY" };
    }
    if (hasText && text.length > MAX_FREE_TEXT_LENGTH) {
      return { ok: false, error: "TEXT_TOO_LONG" };
    }
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status !== "running") return { ok: false, error: "SESSION_NOT_ACTIVE" };
    const ocSessionId = cur.data.ocSessionId;
    if (!ocSessionId) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    // Pastikan client agent siap SEBELUM menyimpan echo user.
    const client = clientFor(cur.data.agentType, cur.data.projectId);
    if (!client) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    // Gambar upload dipetakan ke info + path absolut. Kegagalan resolve
    // (id tidak dikenal / sudah dihapus) menolak pengiriman tanpa echo.
    const imageInfos: { id: string; filename: string; mime: string; absPath: string }[] = [];
    for (const id of images) {
      const info = attachments?.info(sessionId, id);
      if (!info?.ok) return { ok: false, error: "ATTACHMENT_NOT_FOUND" };
      imageInfos.push(info.data);
    }

    // Echo pesan user (disimpan + dikirim ke Client) sebelum menunggu balasan.
    // Referensi @file ikut di-echo sebagai part `file` mime text/plain;
    // gambar upload sebagai part `file` mime image/* dengan `attachmentId`
    // agar renderer dapat memuat bytes lewat HTTP. Path relatif project
    // diubah ke file URL absolut (`file:///abs/path`, host kosong) —
    // `pathToFileURL` juga benar untuk path Windows (`file:///D:/…`) dan
    // meng-escape `#`/`?`/spasi.
    const promptFiles: AgentPromptFile[] = [];
    const userParts: MessagePart[] = [{ type: "text", text }];
    for (const filename of files) {
      const url = pathToFileURL(path.resolve(cur.data.cwd, filename)).href;
      userParts.push({ type: "file", mime: "text/plain", filename, url });
      promptFiles.push({ uri: url, name: filename, mime: "text/plain" });
    }
    /** Lampiran biner (zip, audio, …): tidak dikirim sebagai part. */
    const pathOnly: { filename: string; absPath: string }[] = [];
    for (const info of imageInfos) {
      // Jaring pengaman: `file://` harus menunjuk path absolut (host kosong).
      const url = pathToFileURL(path.resolve(info.absPath)).href;
      // Echo selalu memakai mime asli (renderer memilih thumbnail / kartu).
      userParts.push({
        type: "file",
        mime: info.mime,
        filename: info.filename,
        url,
        attachmentId: info.id,
      });
      // Ke model: hanya mime yang diterima provider (gambar/PDF/teks). Mime
      // lain merusak turn (dan riwayat) dengan "functionality not supported".
      const modelMime = modelFacingMime(info.mime, info.filename);
      if (modelMime) promptFiles.push({ uri: url, name: info.filename, mime: modelMime });
      else pathOnly.push({ filename: info.filename, absPath: path.resolve(info.absPath) });
    }
    const userMessage: SessionMessage = {
      id: `usr_${randomUUID()}`,
      sessionId,
      role: "user",
      parts: userParts,
      createdAt: now(),
    };
    if (!store.insertMessage(userMessage).ok) return { ok: false, error: "MESSAGE_WRITE_FAILED" };
    onMessage?.(userMessage);

    // Judul SEMENTARA sampai agent mengirim judul hasil generate
    // (`session.renamed`, biasanya beberapa detik). Bila masih placeholder /
    // null, turunkan dari teks prompt pertama. Gambar saja -> "Image".
    if (isPlaceholderTitle(cur.data.title)) {
      const candidate = deriveSessionTitle(text) ?? (hasImages ? "Image" : null);
      if (candidate && store.updateSessionTitle(sessionId, candidate).ok) {
        onTitleChange?.(sessionId, candidate);
      }
    }

    // Turn sebelumnya yang belum idle ditutup dulu agar parts-nya tidak
    // tercampur ke turn baru dan tidak hilang.
    turns.finish(sessionId);

    // Mulai turn streaming: parts hasil proyeksi event di-forward. Jaring
    // pengaman bila akhir eksekusi tidak pernah datang (mis. agent mati di
    // tengah turn): batas IDLE, di-reset tiap tanda hidup — parts yang sudah
    // terkumpul tetap disimpan saat dipicu.
    turns.begin(sessionId, turnIdleTimeoutMs, friendlySendError("TURN_TIMEOUT"));

    // Custom instruction Project dibaca saat kirim (bukan saat Session dibuat)
    // agar perubahan instruksi langsung berlaku di prompt berikutnya.
    const projectRes = store.getProjectById(cur.data.projectId);
    const system = projectRes.ok ? (projectRes.data.instructions ?? null) : null;

    // File biner dirujuk lewat path agar model bisa memakai tool (bash/read)
    // bila perlu; teks yang tampil di bubble tetap teks asli pengguna.
    const promptText =
      pathOnly.length === 0
        ? text
        : [
            text,
            "Attached files (saved on disk, not shown inline):",
            ...pathOnly.map((f) => `- ${f.filename}: ${f.absPath}`),
          ]
            .filter((line) => line !== "")
            .join("\n");

    enqueue(sessionId, async () => {
      try {
        // Terapkan pilihan Session (model, agent, instruksi Project) lalu
        // kirim prompt; hasil turn tiba lewat event dan ditutup oleh
        // `session.execution.*` Session akar.
        const steps = [
          () => client.session.switchModel(ocSessionId, cur.data.model),
          () => client.session.switchAgent(ocSessionId, cur.data.agent),
          () => client.session.instructions(ocSessionId, system),
          () =>
            client.session.prompt({ sessionID: ocSessionId, text: promptText, files: promptFiles }),
        ];
        for (const step of steps) {
          const res = await step();
          if (!res.ok) {
            turns.fail(sessionId, friendlySendError(res.error ?? "AGENT_PROMPT_FAILED"));
            return;
          }
        }
      } catch (e) {
        turns.fail(sessionId, friendlySendError(`SEND_FAILED: ${(e as Error).message}`));
      }
    });

    return { ok: true };
  }

  async function resolvePrompt(
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): Promise<SimpleResult> {
    const p = store.getPrompt(promptId);
    if (!p.ok) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.sessionId !== sessionId) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.status !== "pending") return { ok: false, error: "PROMPT_ALREADY_RESOLVED" };

    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const client = clientFor(cur.data.agentType, cur.data.projectId);
    if (!client) return { ok: false, error: "SESSION_NOT_ACTIVE" };
    const rootSession = cur.data.ocSessionId;

    // Kumpulkan request pending yang identik (grup kartu yang sama di UI):
    // jawaban satu kartu diteruskan ke seluruh anggota grup. Tanpa ini,
    // kartu kembar yang tertinggal di agent membuat turn berikutnya
    // menggantung menunggu keputusan yang sudah diambil user.
    const targets = store
      .listPendingPrompts(sessionId)
      .filter((q) => q.id !== promptId && permissionGroupKey(q) === permissionGroupKey(p.data));

    /** Session agent pemilik prompt (child sub-agent atau Session akar). */
    const ownerOf = (id: string): string | null => projector.promptOwner(id) ?? rootSession;

    /**
     * Jawab satu prompt. Permission: `always` = "Always allow" — agent
     * mengingat pola yang disetujui sehingga request identik berikutnya tidak
     * lagi menampilkan kartu; `deny`/`cancel` = tolak. Question (form): label
     * terpilih per pertanyaan diubah ke jawaban form; `cancel` = batalkan form.
     * Opsi yang tidak ada di daftar tersimpan TIDAK ditolak di sini — agent
     * yang tahu daftar sebenarnya (baris DB lama / skema berubah).
     */
    const answer = async (id: string, kind: InteractivePrompt["kind"]): Promise<SimpleResult> => {
      const owner = ownerOf(id);
      if (!owner) return { ok: false, error: "SESSION_NOT_ACTIVE" };
      if (kind === "permission") {
        const decision =
          response === "approve"
            ? "once"
            : response === "always"
              ? "always"
              : response === "deny" || response === "cancel"
                ? "reject"
                : null;
        if (!decision) return { ok: false, error: "INVALID_PROMPT_RESPONSE" };
        return client.permission.reply({ sessionID: owner, requestID: id, decision });
      }
      if (response === "cancel") return client.form.cancel({ sessionID: owner, formID: id });
      const labels = labelsFromResponse(response);
      if (!labels) return { ok: false, error: "INVALID_PROMPT_RESPONSE" };
      return client.form.reply({
        sessionID: owner,
        formID: id,
        answer: formAnswerFromLabels(projector.form(id), labels),
      });
    };

    const res = await answer(promptId, p.data.kind);
    if (!res.ok) {
      if (res.error === AGENT_REQUEST_GONE) {
        // Agent tidak lagi menunggu request ini: sudah dijawab dari klien
        // lain, dibatalkan karena turn di-interrupt, atau agent di-restart.
        // Tanpa penutupan di sini, baris DB tetap `pending`: kartu tidak bisa
        // dijawab MAUPUN di-Skip dan composer tetap tersembunyi — session
        // terkunci. Tutup prompt (dan kembarannya) secara lokal supaya UI pulih.
        updatePromptResolved(promptId);
        projector.forgetPrompt(promptId);
        for (const twin of targets) {
          updatePromptResolved(twin.id);
          projector.forgetPrompt(twin.id);
          onPromptResolved?.(sessionId, twin.id);
        }
        return { ok: false, error: "PROMPT_EXPIRED" };
      }
      return { ok: false, error: res.error };
    }
    updatePromptResolved(promptId);
    projector.forgetPrompt(promptId);
    // Jawaban question cukup lewat reply API — tidak di-echo ke riwayat chat
    // agar transcript bersih (agent tetap menerima jawabannya).
    // Fan-out best-effort ke kartu kembar; kegagalan satu request tidak
    // menggagalkan jawaban utama yang sudah diterima agent.
    for (const twin of targets) {
      const twinRes = await answer(twin.id, twin.kind);
      if (twinRes.ok) {
        updatePromptResolved(twin.id);
        projector.forgetPrompt(twin.id);
        onPromptResolved?.(sessionId, twin.id);
      }
    }
    return { ok: true };
  }

  /** Requirement 2.4: seluruh Session `running` tanpa agent -> `crashed`. */
  function reconcileOnStartup(): void {
    for (const s of store.listSessions()) {
      if (s.status === "running") {
        updateStatus(s.id, "crashed", now());
      }
    }
  }

  /**
   * Requirement 2.3: simpan status terakhir Session `running` dalam budget
   * waktu, lalu lepas seluruh backend agent.
   */
  async function shutdown(): Promise<void> {
    // Refresh skill tertunda tidak relevan lagi: client dilepas, skill
    // terbaca saat client dibuat berikutnya.
    for (const projectId of [...skillRefreshTimers.keys()]) cancelScheduledSkillRefresh(projectId);
    pendingSkillRefresh.clear();
    const running = store.listSessions().filter((s) => s.status === "running");
    const results = running.map((s) => store.insertStatusHistory(s.id, "running", now()));
    await raceWithTimeout(Promise.resolve(results), shutdownBudgetMs);
    await Promise.all(SUPPORTED_AGENT_TYPES.map((t) => backendFor(t)?.shutdown()));
  }

  /** Balapan dengan timer budget; timer selalu dibersihkan setelah selesai. */
  async function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: unknown;
    const timeout: Promise<T> = new Promise((_resolve, reject) => {
      timer = setTimeoutFn(() => reject(new Error("shutdown budget exceeded")), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer !== undefined) clearTimeoutFn(timer);
    }
  }

  // Saat agent hilang tak terduga, tandai Session project tsb `crashed`.
  const onBackendExit = (agentType: AgentType) => (projectId: string) => {
    const key = backendKey(agentType, projectId);
    if (exitNotified.has(key)) return;
    exitNotified.add(key);
    const crashedAt = now();
    for (const s of store.listSessions()) {
      if (s.projectId === projectId && s.agentType === agentType && s.status === "running") {
        // Agent mati di tengah turn: selamatkan parts yang sudah ter-stream.
        turns.finish(s.id, "crash");
        updateStatus(s.id, "crashed", crashedAt);
        unmapOcSessions(s.id);
      }
    }
  };
  for (const agentType of SUPPORTED_AGENT_TYPES) {
    backendFor(agentType)?.onLost(onBackendExit(agentType));
  }

  return {
    createSession,
    listSessions,
    getSession,
    stopSession,
    interruptSession,
    resumeSession,
    deleteSession,
    releaseProject,
    listModels,
    listAgents,
    listMcp,
    listSkills,
    refreshSkills,
    hasPendingSkillRefresh,
    setSessionModel,
    setSessionAgent,
    findFiles,
    sessionContext,
    sendFreeTextInput,
    resolvePrompt,
    reconcileOnStartup,
    shutdown,
  };
}
