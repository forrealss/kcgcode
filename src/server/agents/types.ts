/**
 * Kontrak lapisan agent KCG Code — mengacu ke opencode SDK v2.
 *
 * Setiap CLI agent (opencode v2, Claude Code lewat Claude Agent SDK) dibungkus
 * adapter yang berbicara dalam bentuk YANG SAMA dengan API & event opencode
 * v2: Session terikat `location.directory`, event bertipe
 * `session.text.*` / `session.tool.*` / `session.execution.*` /
 * `permission.asked` / `form.*`, dan payload di bawah `data`. opencode v2
 * hampir diteruskan apa adanya; Claude Code diterjemahkan ke bentuk ini.
 *
 * Fitur khas sebuah agent yang tidak punya padanan v2 TIDAK dipaksakan ke
 * konsep opencode: adapter mendeklarasikannya lewat `capabilities` dan
 * memancarkan event bernamespace `agent.*`.
 */
import type {
  AgentOption,
  AgentType,
  FileChange,
  McpServerInfo,
  ModelOption,
  PermissionModeOption,
  SkillInfo,
  SlashCommandInfo,
  TodoItem,
} from "../../types";
import type { Result, SimpleResult } from "../result";

// ---------------------------------------------------------------------------
// Event (bentuk opencode v2: `{ type, data }`)
// ---------------------------------------------------------------------------

/** Error terstruktur (opencode v2 `SessionStructuredError`). */
export interface AgentError {
  /** Kategori, mis. `aborted`, `provider.auth`, `provider.transport`. */
  type: string;
  message: string;
  status?: number;
}

/** Referensi model (opencode v2 `ModelRef`). */
export interface AgentModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

/** Satu blok konten hasil tool (opencode v2 `ToolContent`). */
export interface AgentToolContent {
  type: string;
  text?: string;
  [k: string]: unknown;
}

/** Opsi field form. */
export interface AgentFormOption {
  value: string;
  label: string;
  description?: string;
}

/** Satu field form (subset opencode v2 `FormField`). */
export interface AgentFormField {
  key: string;
  title?: string;
  description?: string;
  type: "string" | "multiselect" | "boolean" | "number" | "integer" | (string & {});
  options?: AgentFormOption[];
  /** Jawaban bebas di luar `options` diizinkan. */
  custom?: boolean;
  required?: boolean;
  hidden?: boolean;
}

/** Form yang menunggu jawaban user (opencode v2 `FormInfo`). */
export interface AgentForm {
  id: string;
  sessionID: string;
  title: string;
  fields: AgentFormField[];
  metadata?: Record<string, unknown>;
}

/** Nilai jawaban satu field form (opencode v2 `FormValue`). */
export type AgentFormValue = string | number | boolean | string[];

/** Jawaban form per `field.key`. */
export type AgentFormAnswer = Record<string, AgentFormValue>;

type SessionData<T = unknown> = { sessionID: string } & T;
type StepData<T = unknown> = SessionData<{ assistantMessageID: string } & T>;

/** Penanda event (union terdiskriminasi `type` -> `data`). */
interface Ev<T extends string, D> {
  type: T;
  data: D;
  /** Direktori Session (bila diketahui) — opencode v2 `location`. */
  location?: { directory: string };
}

export type AgentEvent =
  | Ev<"session.created", SessionData<{ parentID?: string; title?: string }>>
  | Ev<"session.renamed", SessionData<{ title: string }>>
  | Ev<"session.execution.started", SessionData>
  | Ev<"session.execution.succeeded", SessionData>
  | Ev<"session.execution.failed", SessionData<{ error: AgentError }>>
  | Ev<
      "session.execution.interrupted",
      SessionData<{ reason: "user" | "shutdown" | "superseded" | "inactivity" | (string & {}) }>
    >
  | Ev<"session.step.started", StepData<{ agent?: string; model?: AgentModelRef }>>
  | Ev<"session.step.ended", StepData<{ finish?: string }>>
  | Ev<"session.step.failed", StepData<{ error: AgentError }>>
  | Ev<"session.text.started", StepData<{ ordinal: number }>>
  | Ev<"session.text.delta", StepData<{ ordinal: number; delta: string }>>
  | Ev<"session.text.ended", StepData<{ ordinal: number; text: string }>>
  | Ev<"session.reasoning.started", StepData<{ ordinal: number }>>
  | Ev<"session.reasoning.delta", StepData<{ ordinal: number; delta: string }>>
  | Ev<"session.reasoning.ended", StepData<{ ordinal: number; text: string }>>
  | Ev<"session.tool.input.started", StepData<{ id: string; name: string }>>
  | Ev<
      "session.tool.called",
      StepData<{
        id: string;
        input: Record<string, unknown> /** Nama tool bila adapter tahu. */;
        name?: string;
      }>
    >
  | Ev<"session.tool.progress", StepData<{ id: string; metadata?: Record<string, unknown> }>>
  | Ev<
      "session.tool.success",
      StepData<{ id: string; content?: AgentToolContent[]; metadata?: Record<string, unknown> }>
    >
  | Ev<
      "session.tool.failed",
      StepData<{
        id: string;
        error: AgentError;
        content?: AgentToolContent[];
        metadata?: Record<string, unknown>;
      }>
    >
  | Ev<"session.retry.scheduled", SessionData<{ attempt: number; at?: number; error: AgentError }>>
  | Ev<"permission.asked", SessionData<{ id: string; action: string; resources: string[] }>>
  | Ev<"permission.replied", SessionData<{ requestID: string }>>
  | Ev<"form.created", { form: AgentForm }>
  | Ev<"form.replied", SessionData<{ id: string }>>
  | Ev<"form.cancelled", SessionData<{ id: string }>>
  /** Tanda hidup tanpa konten (proses agent masih bekerja). */
  | Ev<"agent.activity", SessionData>
  /** Task list agent berubah (TodoWrite Claude / todowrite opencode). */
  | Ev<"agent.todos.updated", SessionData<{ todos: TodoItem[] }>>
  /**
   * Permission mode Session yang BERLAKU di agent berubah — termasuk
   * perubahan oleh agent sendiri (mis. rencana disetujui -> `acceptEdits`).
   */
  | Ev<"agent.permission_mode.changed", SessionData<{ mode: string }>>;

export type AgentEventType = AgentEvent["type"];

/** Ambil tipe `data` untuk satu jenis event. */
export type AgentEventData<T extends AgentEventType> = Extract<AgentEvent, { type: T }>["data"];

// ---------------------------------------------------------------------------
// Client (bentuk opencode v2, terikat satu direktori Project)
// ---------------------------------------------------------------------------

/**
 * Kode error saat request permission/form sudah tidak ditunggu agent
 * (dijawab klien lain, turn di-abort, atau agent di-restart).
 */
export const AGENT_REQUEST_GONE = "AGENT_REQUEST_GONE";

/** Info Session di sisi agent. */
export interface AgentSessionInfo {
  id: string;
  title?: string;
  directory?: string;
}

/** Lampiran prompt: `@file` teks maupun gambar/berkas upload. */
export interface AgentPromptFile {
  /** URL `file:///abs/path`. */
  uri: string;
  /** Nama tampilan (path relatif project / nama file asli). */
  name: string;
  /** MIME yang diserahkan ke model (`text/plain` untuk `@file`). */
  mime: string;
}

export type AgentPermissionDecision = "once" | "always" | "reject";

/**
 * Fitur yang dimiliki sebuah agent — UI & Session_Manager memakai ini alih-alih
 * mengecek tipe agent. Fitur khas agent (mis. permission mode Claude Code)
 * dideklarasikan di sini, bukan dipetakan ke konsep opencode.
 */
export interface AgentCapabilities {
  /** Daftar skill perlu di-refresh (cache sisi agent) setelah skill dipasang. */
  skillReload: boolean;
  /** Permission mode yang ditawarkan; kosong = agent tidak punya konsep ini. */
  permissionModes: PermissionModeOption[];
}

export interface AgentClient {
  readonly kind: AgentType;
  readonly directory: string;
  readonly capabilities: AgentCapabilities;

  session: {
    /** Buat Session. Tanpa `title`, agent meng-generate judul dari prompt pertama. */
    create(input?: { title?: string }): Promise<Result<AgentSessionInfo>>;
    /** Session masih dikenal agent? */
    get(sessionID: string): Promise<Result<AgentSessionInfo>>;
    /** Hapus Session beserta riwayatnya. Session yang sudah tidak ada = sukses. */
    remove(sessionID: string): Promise<SimpleResult>;
    /**
     * Model + thinking effort untuk prompt berikutnya (`null` = default
     * agent). `effort` = salah satu `ModelOption.efforts` model itu — variant
     * model di opencode, `effort` di Claude Code; tanpa nilai = default model.
     */
    switchModel(
      sessionID: string,
      model: ModelSelection | null,
      effort?: string | null,
    ): Promise<SimpleResult>;
    /** Agent/mode untuk prompt berikutnya (`null` = default agent). */
    switchAgent(sessionID: string, agent: string | null): Promise<SimpleResult>;
    /** Instruksi tambahan Project (custom instruction); `null` = hapus. */
    instructions(sessionID: string, text: string | null): Promise<SimpleResult>;
    /**
     * Ganti permission mode Session (`null` = default settings agent). Berlaku
     * SEGERA — juga di tengah turn yang sedang berjalan — bila agent mendukung
     * (`capabilities.permissionModes`); selain itu error
     * `AGENT_PERMISSION_MODE_UNSUPPORTED`.
     */
    setPermissionMode(sessionID: string, mode: string | null): Promise<SimpleResult>;
    /**
     * Kirim prompt tanpa menunggu balasan. Hasil turn tiba lewat event dan
     * ditutup `session.execution.succeeded|failed|interrupted`. Teks yang
     * diawali `/nama` dijalankan sebagai slash command bila `nama` ada di
     * `command.list()` (selain itu dikirim sebagai teks biasa).
     */
    prompt(input: {
      sessionID: string;
      text: string;
      files?: AgentPromptFile[];
    }): Promise<SimpleResult>;
    /** Hentikan turn yang sedang berjalan. */
    interrupt(sessionID: string): Promise<SimpleResult>;
    /** Task list Session (kosong bila agent belum memakainya). */
    todos(sessionID: string): Promise<Result<TodoItem[]>>;
  };
  permission: {
    reply(input: {
      sessionID: string;
      requestID: string;
      decision: AgentPermissionDecision;
    }): Promise<SimpleResult>;
  };
  form: {
    reply(input: {
      sessionID: string;
      formID: string;
      answer: AgentFormAnswer;
    }): Promise<SimpleResult>;
    cancel(input: { sessionID: string; formID: string }): Promise<SimpleResult>;
  };
  model: { list(): Promise<Result<ModelOption[]>> };
  agent: { list(): Promise<Result<AgentOption[]>> };
  mcp: { list(): Promise<Result<McpServerInfo[]>> };
  skill: { list(): Promise<Result<SkillInfo[]>> };
  /** Slash command yang bisa dijalankan lewat prompt `/nama args`. */
  command: { list(): Promise<Result<SlashCommandInfo[]>> };
  file: { find(query: string): Promise<Result<string[]>> };
  vcs: { status(): Promise<Result<FileChange[]>> };
  location: {
    /** Muat ulang config/skill agent untuk direktori ini. */
    reload(): Promise<SimpleResult>;
  };
  event: {
    /** Langganan event Session di direktori ini; kembalikan fungsi berhenti. */
    subscribe(cb: (ev: AgentEvent) => void): () => void;
  };
}

/** Pilihan model Session (bentuk penyimpanan KCG). */
export interface ModelSelection {
  providerID: string;
  modelID: string;
}

// ---------------------------------------------------------------------------
// Backend (satu per tipe agent)
// ---------------------------------------------------------------------------

export interface AgentBackend {
  readonly kind: AgentType;
  /** Pastikan client untuk Project siap (koneksi/proses agent dibuat bila perlu). */
  ensure(projectId: string, directory: string): Promise<Result<AgentClient>>;
  /** Client Project yang sudah siap (tanpa membuat baru). */
  get(projectId: string): AgentClient | undefined;
  /** Lepas sumber daya milik Project. */
  release(projectId: string): Promise<void>;
  /** Lepas seluruh sumber daya (shutdown aplikasi). */
  shutdown(): Promise<void>;
  /**
   * Hook saat backend kehilangan Project secara tak terduga (proses/service
   * agent mati) — turn yang berjalan tidak akan pernah selesai.
   */
  onLost(cb: (projectId: string) => void): void;
}

/** Turunan hasil sukses tanpa data. */
export const OK: SimpleResult = { ok: true };
