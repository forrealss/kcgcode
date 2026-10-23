/**
 * Operasi Session Claude Code (`AgentClient.session`): buat/cek, prompt,
 * ganti model/effort/mode/instruksi, interrupt, hapus, task list, dan
 * pemakaian context window. Proses `claude`-nya dikelola `processes.ts`.
 */
import { randomUUID } from "node:crypto";
import type { EffortLevel, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { SimpleResult } from "../../result";
import type { AgentClient, AgentPromptFile, ModelSelection } from "../types";
import type { PendingAsks } from "./asks";
import {
  CLAUDE_PROVIDER_ID,
  COMPACT_PROMPT,
  CONTROL_TIMEOUT_MS,
  EFFORT_LEVELS,
  PERMISSION_MODE_IDS,
  USAGE_REFRESH_MS,
} from "./constants";
import { buildUserContent } from "./files";
import type { ClaudeHostSessions } from "./host-sessions";
import { beginInterrupt, type LiveSession, settleInterrupt } from "./live-session";
import type { ClaudeProcesses } from "./processes";
import { type ClaudeTranscripts, withTimeout } from "./sdk";

export interface ClaudeSessionApiDeps {
  cwd: string;
  transcripts: ClaudeTranscripts;
  host: ClaudeHostSessions;
  now: () => number;
  /** Jeda pengecekan ulang transcript setelah proses ditutup saat hapus. */
  deleteSettleMs: number;
  /** Session yang dikenal client (id = UUID session Claude Code). */
  sessions: Map<string, LiveSession>;
  getOrCreate: (id: string, persisted: boolean) => LiveSession;
  asks: PendingAsks;
  processes: ClaudeProcesses;
}

/** Pilihan model Session -> argumen `model` SDK (`null` = default user). */
function selectedModel(model: ModelSelection | null): string | null {
  if (!model || model.providerID !== CLAUDE_PROVIDER_ID) return null;
  return model.modelID === "default" ? null : model.modelID;
}

export function createClaudeSessionApi(deps: ClaudeSessionApiDeps): AgentClient["session"] {
  const { cwd, transcripts, host, now, deleteSettleMs, sessions, getOrCreate, asks, processes } =
    deps;

  /**
   * Transcript Session sedang dipegang proses `claude` interaktif lain
   * (Claude Desktop / CLI) -> pesan error; `resume` dari sini akan membuat dua
   * penulis pada satu transcript.
   */
  async function openElsewhere(sessionId: string): Promise<string | null> {
    const proc = (await host.running().catch(() => new Map())).get(sessionId);
    if (!proc) return null;
    const where =
      proc.entrypoint === "claude-desktop" ? "Claude Desktop" : "another Claude Code window";
    return `This conversation is still open in ${where}. Close it there, then send again.`;
  }

  async function prompt(input: {
    sessionID: string;
    text: string;
    files?: AgentPromptFile[];
  }): Promise<SimpleResult> {
    const live = getOrCreate(input.sessionID, false);
    try {
      const content = await buildUserContent(input.text, input.files ?? []);
      // Prompt tepat setelah interrupt: tunggu turn lama benar-benar berhenti
      // agar idle-nya tidak menutup turn baru ini.
      if (live.interruptSettled) {
        await withTimeout(live.interruptSettled.promise, 15_000, "interrupt").catch(() =>
          settleInterrupt(live),
        );
      }
      processes.cancelIdleClose(live);
      // Instruksi Project hanya bisa dipasang saat proses dibuat — begitu pula
      // kembali ke effort default (proses baru membaca `effortLevel` settings
      // user; kontrol SDK hanya bisa mereset ke default model). Bila berubah
      // dan tidak ada turn berjalan, proses diganti (resume).
      const respawn =
        live.system !== live.wantSystem || (live.effort !== null && live.wantEffort === null);
      if (live.query && respawn && !live.running) processes.closeQuery(live);
      if (live.query) {
        await processes.syncLiveSettings(live, live.query);
      } else {
        const busy = live.persisted ? await openElsewhere(live.id) : null;
        if (busy) return { ok: false, error: `AGENT_PROMPT_FAILED: ${busy}` };
        await processes.startQuery(live);
      }
      live.turnError = null;
      live.manualCompact = COMPACT_PROMPT.test(input.text.trim());
      live.translator.beginTurn();
      live.input?.push({
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
      });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: `AGENT_PROMPT_FAILED: Failed to start Claude Code: ${(e as Error).message}`,
      };
    }
  }

  /**
   * Ganti permission mode Session. Proses `claude` yang hidup diganti modenya
   * SEGERA (`setPermissionMode` SDK) — juga di tengah turn; tanpa proses,
   * mode dipakai saat proses berikutnya di-spawn.
   */
  async function setPermissionMode(sessionId: string, mode: string | null): Promise<SimpleResult> {
    if (mode !== null && !PERMISSION_MODE_IDS.has(mode)) {
      return { ok: false, error: "INVALID_PERMISSION_MODE" };
    }
    const live = getOrCreate(sessionId, false);
    live.wantMode = mode;
    const q = live.query;
    if (!q || mode === live.mode) return { ok: true };
    try {
      await withTimeout(
        q.setPermissionMode((mode ?? "default") as PermissionMode),
        CONTROL_TIMEOUT_MS,
        "setPermissionMode",
      );
      live.mode = mode;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `AGENT_PERMISSION_MODE_FAILED: ${(e as Error).message}` };
    }
  }

  async function interrupt(sessionId: string): Promise<SimpleResult> {
    const live = sessions.get(sessionId);
    if (!live?.query || !live.running) return { ok: true };
    beginInterrupt(live);
    asks.dropSession(sessionId, "Interrupted by the user.");
    try {
      await withTimeout(live.query.interrupt(), CONTROL_TIMEOUT_MS, "interrupt");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `AGENT_ABORT_FAILED: ${(e as Error).message}` };
    }
  }

  async function remove(sessionId: string): Promise<SimpleResult> {
    const live = sessions.get(sessionId);
    const wasLive = live?.query != null;
    if (live) {
      asks.dropSession(sessionId, "Session deleted.");
      const done = live.pumpDone;
      processes.closeQuery(live);
      sessions.delete(sessionId);
      // CLI menulis metadata (judul, biaya) ke transcript saat keluar —
      // tunggu proses berhenti agar file tidak muncul lagi setelah dihapus.
      if (wasLive && done) await withTimeout(done, 5000, "close").catch(() => {});
    }
    try {
      if (await transcripts.exists(sessionId, cwd)) await transcripts.remove(sessionId, cwd);
      if (wasLive) {
        await Bun.sleep(deleteSettleMs);
        if (await transcripts.exists(sessionId, cwd)) await transcripts.remove(sessionId, cwd);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `AGENT_DELETE_SESSION_FAILED: ${(e as Error).message}` };
    }
  }

  return {
    async create() {
      // Proses `claude` baru di-spawn saat prompt pertama (`sessionId` ini).
      const id = randomUUID();
      getOrCreate(id, false);
      return { ok: true, data: { id, directory: cwd } };
    },
    async get(sessionId) {
      if (sessions.has(sessionId)) return { ok: true, data: { id: sessionId, directory: cwd } };
      if (await transcripts.exists(sessionId, cwd)) {
        getOrCreate(sessionId, true);
        return { ok: true, data: { id: sessionId, directory: cwd } };
      }
      return { ok: false, error: "AGENT_SESSION_NOT_FOUND" };
    },
    remove,
    async switchModel(sessionId, model, effort = null) {
      const live = getOrCreate(sessionId, false);
      live.wantModel = selectedModel(model);
      live.wantEffort =
        effort !== null && EFFORT_LEVELS.has(effort) ? (effort as EffortLevel) : null;
      return { ok: true };
    },
    // Claude Code memakai permission mode, bukan agent percakapan ala
    // opencode (lihat `setPermissionMode`).
    async switchAgent() {
      return { ok: true };
    },
    setPermissionMode,
    async instructions(sessionId, text) {
      getOrCreate(sessionId, false).wantSystem = text?.trim() ? text : null;
      return { ok: true };
    },
    prompt,
    interrupt,
    async todos(sessionId) {
      return { ok: true, data: sessions.get(sessionId)?.todos ?? [] };
    },
    async contextUsage(sessionId) {
      const live = sessions.get(sessionId);
      if (!live) return { ok: true, data: null };
      // Proses hidup & angka lama/belum ada -> ukur ulang; selain itu cache
      // (juga setelah proses ditutup idle — angka terakhir tetap berlaku).
      const stale = live.usage === null || now() - live.usage.measuredAt > USAGE_REFRESH_MS;
      if (live.query && stale) await processes.refreshUsage(live);
      return { ok: true, data: live.usage };
    },
  };
}
