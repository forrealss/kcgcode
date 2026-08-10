/**
 * Session_Manager — lifecycle Session & orkestrasi PTY_Process.
 * Sesuai `design.md` — `session-manager.ts`.
 *
 * Tanggung jawab: validasi tipe CLI_Agent, orkestrasi `PtyHandle`, transisi
 * status Session, penerusan input (Interactive_Prompt response & free-text),
 * serta rekonsiliasi saat startup (Requirement 2.4).
 *
 * Prinsip penting:
 * - `createSession` memvalidasi urutan (1) agentType didukung, (2) Project
 *   ada di store, (3) direktori kerja Project masih ada di filesystem.
 *   Kegagalan langkah mana pun mengembalikan error spesifik tanpa membuat
 *   baris `sessions` berstatus `running` (Requirement 1.3, 1.4, 10.10, 10.11).
 * - Kegagalan spawn (`Bun.spawn` melempar atau proses langsung exit dengan
 *   error) menghasilkan status `crashed` dan error, tanpa pernah menandai
 *   Session sebagai `running` di Session_Store (Requirement 1.4).
 * - `stopSession` mengirim SIGTERM lalu menjadwalkan SIGKILL setelah 5 detik
 *   bila proses belum keluar (Requirement 1.6). Status menjadi `stopped`
 *   setelah `PtyHandle` keluar.
 * - `onExit` tak terduga dengan kode bukan nol -> `crashed` (Req 1.8).
 * - Timer force-kill & budget shutdown dapat diinjeksi (`setTimeoutFn`/
 *   `clearTimeoutFn`) agar timing bisa diuji dengan fake timer.
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type { SessionStore } from "./db";
import { type PtyHandle, spawnPty } from "./pty-process";
import type { AgentType, OutputChunk, PromptResponse, Result, Session } from "./types";

export const MAX_FREE_TEXT_LENGTH = 10000;
export const FORCE_KILL_MS = 5000;
export const SHUTDOWN_BUDGET_MS = 5000;

export const SUPPORTED_AGENT_TYPES: readonly AgentType[] = ["opencode", "claude-code"];

const AGENT_COMMANDS: Record<AgentType, string[]> = {
  opencode: ["opencode"],
  "claude-code": ["claude-code"],
};

export interface CreateSessionRequest {
  agentType: AgentType;
  projectId: string;
}

export type CreateSessionResult = { ok: true; session: Session } | { ok: false; error: string };

export type SimpleResult = { ok: boolean; error?: string };

export type SpawnPtyFn = (cmd: string[], cwd: string, sessionId: string) => PtyHandle;

export interface SessionManagerOptions {
  store: SessionStore;
  spawn?: SpawnPtyFn;
  now?: () => number;
  forceKillMs?: number;
  shutdownBudgetMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Hook Output_Stream baru — disambungkan ke WebSocket_Gateway (task 17). */
  onOutput?: (chunk: OutputChunk) => void;
}

export interface SessionManager {
  createSession(req: CreateSessionRequest): CreateSessionResult;
  listSessions(): Session[];
  getSession(sessionId: string): Result<Session>;
  stopSession(sessionId: string): SimpleResult;
  sendFreeTextInput(sessionId: string, text: string): SimpleResult;
  resolvePrompt(sessionId: string, promptId: string, response: PromptResponse): SimpleResult;
  reconcileOnStartup(): void;
  shutdown(): Promise<void>;
}

/**
 * Membuat instance Session_Manager terikat pada `store`.
 * `spawn`, `now`, dan timer dapat diinjeksi untuk keperluan pengujian.
 */
export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  const store = opts.store;
  const spawn = opts.spawn ?? spawnPty;
  const now = opts.now ?? Date.now;
  const forceKillMs = opts.forceKillMs ?? FORCE_KILL_MS;
  const shutdownBudgetMs = opts.shutdownBudgetMs ?? SHUTDOWN_BUDGET_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const onOutput = opts.onOutput;

  /** PtyHandle aktif per Session (di memori proses server). */
  const handles = new Map<string, PtyHandle>();
  /** Timer force-kill SIGKILL per Session (Requirement 1.6). */
  const forceKillTimers = new Map<string, unknown>();
  /** Counter `seq` Output_Stream per Session (offset reattach, Requirement 4.2). */
  const seqCounters = new Map<string, number>();

  function clearForceKill(sessionId: string): void {
    const timer = forceKillTimers.get(sessionId);
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      forceKillTimers.delete(sessionId);
    }
  }

  /**
   * Handler exit dari `PtyHandle` (Requirement 1.6 & 1.8):
   * - `expected` (stopSession diminta) atau proses selesai bersih (kode 0):
   *   status -> `stopped`
   * - exit tak terduga dengan kode bukan nol / sinyal: status -> `crashed`
   *   + timestamp kejadian
   *
   * `handles.delete` selalu dijalankan agar sebuah Session berstatus
   * `running` tidak pernah kehilangan prosesnya tanpa perubahan status
   * (konsistensi status vs keberadaan proses).
   */
  function onPtyExit(sessionId: string, code: number | null, expected: boolean): void {
    clearForceKill(sessionId);
    handles.delete(sessionId);
    const cur = store.getSession(sessionId);
    if (!cur.ok || cur.data.status !== "running") return;
    if (expected || code === 0) {
      store.updateSessionStatus(sessionId, "stopped", now());
    } else {
      store.updateSessionStatus(sessionId, "crashed", now());
    }
  }

  function createSession(req: CreateSessionRequest): CreateSessionResult {
    // (1) tipe CLI_Agent didukung (Requirement 1.3)
    if (!SUPPORTED_AGENT_TYPES.includes(req.agentType)) {
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

    const sessionId = randomUUID();
    const createdAt = now();
    const session: Session = {
      id: sessionId,
      projectId: project.id,
      agentType: req.agentType,
      cwd: project.path,
      status: "running",
      createdAt,
      updatedAt: createdAt,
    };

    let handle: PtyHandle;
    try {
      handle = spawn(AGENT_COMMANDS[req.agentType], project.path, sessionId);
    } catch (e) {
      // Requirement 1.4: sesi dicatat `crashed`, bukan `running`.
      const crashed: Session = { ...session, status: "crashed", updatedAt: now() };
      store.insertSession(crashed);
      store.insertStatusHistory(sessionId, "crashed", now());
      return { ok: false, error: `PROCESS_SPAWN_FAILED: ${(e as Error).message}` };
    }
    handles.set(sessionId, handle);

    let prematureExit: number | null | undefined;
    let inserted = false;

    // Output_Stream -> Session_Store (Requirement 3.1) + hook gateway.
    handle.onData((chunk) => {
      const base = seqCounters.get(sessionId) ?? store.getLastSeq(sessionId);
      const seq = base + 1;
      seqCounters.set(sessionId, seq);
      const out: OutputChunk = { sessionId, seq, data: chunk, ts: now() };
      const res = store.insertOutputChunk(out);
      if (res.ok) onOutput?.(out);
    });

    // `onExit` dapat terpanggil SEBELUM Session tercatat di store
    // (proses langsung exit saat pembuatan) -> tandai premature.
    handle.onExit((code, expected) => {
      if (!inserted) {
        prematureExit = code;
        return;
      }
      onPtyExit(sessionId, code, expected);
    });

    if (prematureExit !== undefined) {
      // Requirement 1.4: proses langsung exit saat pembuatan -> `crashed`.
      const crashed: Session = { ...session, status: "crashed", updatedAt: now() };
      store.insertSession(crashed);
      store.insertStatusHistory(sessionId, "crashed", now());
      handles.delete(sessionId);
      return {
        ok: false,
        error: `PROCESS_SPAWN_FAILED: exited with code ${prematureExit}`,
      };
    }

    inserted = true;
    const ins = store.insertSession(session);
    if (!ins.ok) {
      // Jangan tinggalkan proses yatim bila persistensi gagal (Requirement 3.2).
      handle.kill("SIGKILL");
      handles.delete(sessionId);
      return ins;
    }
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
    const handle = handles.get(sessionId);
    if (!handle) return { ok: false, error: "SESSION_NOT_RUNNING" };

    handle.kill("SIGTERM");
    const timer = setTimeoutFn(() => handle.kill("SIGKILL"), forceKillMs);
    forceKillTimers.set(sessionId, timer);
    return { ok: true };
  }

  function sendFreeTextInput(sessionId: string, text: string): SimpleResult {
    if (text.length < 1 || text.trim().length === 0) {
      return { ok: false, error: "TEXT_EMPTY" };
    }
    if (text.length > MAX_FREE_TEXT_LENGTH) {
      return { ok: false, error: "TEXT_TOO_LONG" };
    }
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status !== "running") return { ok: false, error: "SESSION_NOT_ACTIVE" };
    const handle = handles.get(sessionId);
    if (!handle) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    handle.write(`${text}\n`);
    return { ok: true };
  }

  function resolvePrompt(
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): SimpleResult {
    const p = store.getPrompt(promptId);
    if (!p.ok) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.sessionId !== sessionId) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.status !== "pending") return { ok: false, error: "PROMPT_ALREADY_RESOLVED" };

    // Requirement 6.7: Cancel menandai resolved tanpa meneruskan input.
    if (response === "cancel") {
      store.updatePromptStatus(promptId, "resolved", now());
      return { ok: true };
    }

    const handle = handles.get(sessionId);
    if (p.data.type === "menu") {
      // Requirement 6.6: opsi harus bagian dari daftar menu prompt tsb.
      if (typeof response !== "object" || !p.data.options?.includes(response.option)) {
        return { ok: false, error: "INVALID_PROMPT_OPTION" };
      }
      handle?.write(`${response.option}\n`);
    } else if (response === "approve") {
      handle?.write("y\n");
    } else if (response === "deny") {
      handle?.write("n\n");
    } else {
      return { ok: false, error: "INVALID_PROMPT_RESPONSE" };
    }

    // Requirement 6.4: tandai resolved setelah diteruskan.
    store.updatePromptStatus(promptId, "resolved", now());
    return { ok: true };
  }

  /** Requirement 2.4: seluruh Session `running` tanpa proses -> `crashed`. */
  function reconcileOnStartup(): void {
    for (const s of store.listSessions()) {
      if (s.status === "running") {
        store.updateSessionStatus(s.id, "crashed", now());
      }
    }
  }

  /**
   * Requirement 2.3: simpan status terakhir seluruh Session `running` ke
   * `session_status_history` dalam anggaran waktu 5 detik (`Promise.race`).
   */
  async function shutdown(): Promise<void> {
    const running = store.listSessions().filter((s) => s.status === "running");
    const results = running.map((s) => store.insertStatusHistory(s.id, "running", now()));
    await raceWithTimeout(Promise.resolve(results), shutdownBudgetMs);
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

  return {
    createSession,
    listSessions,
    getSession,
    stopSession,
    sendFreeTextInput,
    resolvePrompt,
    reconcileOnStartup,
    shutdown,
  };
}
