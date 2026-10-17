/**
 * Kontrak publik Session_Manager: opsi/hook, request, dan antarmuka
 * `SessionManager`, beserta konstanta & validasi bersama.
 */

import type { SessionStore } from "../../../db";
import type {
  AgentCapabilitiesInfo,
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
  SlashCommandInfo,
} from "../../../types";
import type { AgentBackend, AgentExternalSession } from "../../agents/types";
import type { Result, SimpleResult } from "../../result";
import type { AttachmentManager } from "../attachments";
import type { TurnOutcome } from "../turn-stream";
import type { ImportExternalSessionRequest } from "./external-sessions";

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
 * Bentuk id thinking effort (`low`, `xhigh`, variant opencode mis.
 * `reasoning-high`). Isi sebenarnya divalidasi agent per model.
 */
export function isEffortId(effort: string): boolean {
  return /^[A-Za-z0-9][\w.-]{0,31}$/.test(effort);
}

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
  /** Thinking effort pilihan user (`ModelOption.efforts`); null/undefined = default model. */
  effort?: string | null;
  /** Agent (mode) pilihan user; null/undefined = default agent. */
  agent?: string | null;
  /**
   * Permission mode pilihan user (agent dengan capability `permissionModes`);
   * null/undefined = default settings agent.
   */
  permissionMode?: string | null;
}

export type CreateSessionResult = { ok: true; session: Session } | { ok: false; error: string };

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
  /**
   * Instruksi sistem tambahan dari kcgcode untuk Session (mis. dev server
   * Preview dipegang kcgcode) — digabung setelah instruksi Project.
   */
  extraInstructions?: (session: Session) => string | null;
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
  /**
   * Hook permission mode Session berubah — oleh user maupun agent (mis.
   * rencana disetujui). Disambungkan ke WebSocket_Gateway.
   */
  onPermissionModeChange?: (sessionId: string, mode: string | null) => void;
  /** Hook status compact Session berubah (mulai / selesai meringkas riwayat). */
  onCompactionChange?: (sessionId: string, compacting: boolean) => void;
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
  /**
   * Session agent yang dibuat di luar KCG (Claude Desktop / CLI) untuk
   * direktori Project — yang sudah dipakai Session KCG tidak ikut.
   */
  listExternalSessions(
    projectId: string,
    agentType: AgentType,
  ): Promise<Result<AgentExternalSession[]>>;
  /**
   * Impor Session agent eksternal sebagai Session KCG `running` beserta
   * riwayatnya; prompt berikutnya melanjutkan transcript yang sama. Session
   * yang masih terbuka di aplikasi lain ditolak (`EXTERNAL_SESSION_OPEN`)
   * kecuali `fork` (lanjut di salinan).
   */
  importExternalSession(req: ImportExternalSessionRequest): Promise<CreateSessionResult>;
  /** Daftar model yang tersedia pada server headless milik Project. */
  listModels(projectId: string, agentType?: AgentType): Promise<Result<ModelOption[]>>;
  /**
   * Daftar agent (mode) opencode milik Project — primary/all saja, siap
   * ditampilkan di pemilih mode composer.
   */
  listAgents(projectId: string, agentType?: AgentType): Promise<Result<AgentOption[]>>;
  /** Status MCP server yang terkonfigurasi untuk Project. */
  listMcp(projectId: string, agentType?: AgentType): Promise<Result<McpServerInfo[]>>;
  /**
   * Aktifkan / nonaktifkan MCP server Project di agent (Claude Code
   * menyimpannya di config Project; opencode sampai service restart).
   * Berlaku SEGERA, juga untuk Session yang sedang berjalan.
   */
  setMcpEnabled(
    projectId: string,
    name: string,
    enabled: boolean,
    agentType?: AgentType,
  ): Promise<SimpleResult>;
  /** Sambungkan ulang MCP server Project (mis. setelah gagal). */
  reconnectMcp(projectId: string, name: string, agentType?: AgentType): Promise<SimpleResult>;
  /** Skill yang terdaftar untuk Project (global, folder Project, bawaan). */
  listSkills(projectId: string, agentType?: AgentType): Promise<Result<SkillInfo[]>>;
  /**
   * Slash command Project untuk autocomplete `/` di composer (bawaan agent,
   * kustom, skill). Dijalankan lewat prompt `/nama args`.
   */
  listCommands(projectId: string, agentType?: AgentType): Promise<Result<SlashCommandInfo[]>>;
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
   * Ganti thinking effort Session (`null` = default model). Berlaku pada
   * prompt berikutnya, diterapkan bersama model.
   */
  setSessionEffort(sessionId: string, effort: string | null): SimpleResult;
  /**
   * Ganti agent (mode) pilihan Session — `build`, `plan`, atau agent kustom
   * (`null` = default opencode). Berlaku pada prompt berikutnya.
   */
  setSessionAgent(sessionId: string, agent: string | null): SimpleResult;
  /**
   * Ganti permission mode Session (`null` = default settings agent). Berlaku
   * SEGERA bila agent sedang berjalan (juga di tengah turn), selain itu pada
   * prompt berikutnya. Agent tanpa capability `permissionModes` -> ditolak.
   */
  setSessionPermissionMode(sessionId: string, mode: string | null): Promise<SimpleResult>;
  /** Fitur khas agent untuk UI (mis. daftar permission mode). */
  listCapabilities(
    projectId: string,
    agentType?: AgentType,
  ): Promise<Result<AgentCapabilitiesInfo>>;
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
