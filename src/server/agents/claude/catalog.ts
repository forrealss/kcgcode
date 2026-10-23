/**
 * Katalog per Project yang tidak terikat satu Session: daftar model, slash
 * command, MCP, skill, dan file. Request kontrol dikirim ke proses `claude`
 * yang hidup; tanpa proses, dipakai query sementara (`withAnyQuery`).
 */
import type {
  McpServerStatus,
  Options,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type { McpServerInfo, ModelOption, SkillInfo, SlashCommandInfo } from "../../../types";
import type { Result, SimpleResult } from "../../result";
import { mergeClaudeMcp, readClaudeMcpConfig } from "../../services/claude-mcp";
import { claudeGlobalSkillsDir, listClaudeSkills } from "../../services/claude-skills";
import {
  CLAUDE_PROVIDER_ID,
  CONTROL_TIMEOUT_MS,
  FILES_CACHE_MS,
  MODELS_CACHE_MS,
} from "./constants";
import { listProjectFiles, rankFiles } from "./files";
import { type ClaudeQueryFn, type ClaudeQueryLike, InputQueue, withTimeout } from "./sdk";

/**
 * Slash command bawaan yang tidak ditawarkan di composer:
 * - `clear` mengganti id session Claude Code diam-diam (Session KCG akan
 *   tetap me-resume transcript lama);
 * - `model` / `effort` punya pemilih sendiri di KCG — lewat slash, pilihan
 *   tersimpan di KCG tidak ikut berubah;
 * - `color` / `focus` / `heapdump` hanya bermakna di terminal;
 * - `workflow-launch-exec` & nama berawalan `__` = command internal CLI.
 */
const HIDDEN_COMMANDS = new Set([
  "clear",
  "model",
  "effort",
  "color",
  "focus",
  "heapdump",
  "workflow-launch-exec",
]);

/** Slash command SDK -> tipe tampilan; command tersembunyi -> null. */
export function slashCommandInfo(c: SlashCommand): SlashCommandInfo | null {
  if (c.name.startsWith("__") || (c.builtin === true && HIDDEN_COMMANDS.has(c.name))) return null;
  return {
    name: c.name,
    description: c.description?.trim() || null,
    argumentHint: c.argumentHint?.trim() || null,
    ...(c.aliases?.length ? { aliases: c.aliases } : {}),
    ...(c.builtin ? { builtin: true } : {}),
  };
}

function toCommandInfos(commands: SlashCommand[]): SlashCommandInfo[] {
  return commands.map(slashCommandInfo).filter((c): c is SlashCommandInfo => c !== null);
}

/** Status MCP SDK -> status yang dipakai UI. */
function mcpStatus(status: string): McpServerInfo["status"] {
  switch (status) {
    case "connected":
      return "connected";
    case "pending":
      return "pending";
    case "failed":
      return "failed";
    case "needs-auth":
      return "needs_auth";
    case "disabled":
      return "disabled";
    default:
      return "unknown";
  }
}

function toMcpInfos(status: McpServerStatus[]): McpServerInfo[] {
  return status.map((s) => ({
    name: s.name,
    status: mcpStatus(s.status),
    error: s.error ?? null,
  }));
}

export interface ClaudeCatalogDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  now: () => number;
  runQuery: ClaudeQueryFn;
  /** Opsi dasar proses `claude` (cwd, settings, env, executable). */
  sharedOptions: () => Options;
  /** Proses `claude` yang sedang hidup (urut Session). */
  liveQueries: () => ClaudeQueryLike[];
}

export interface ClaudeCatalog {
  listModels(): Promise<Result<ModelOption[]>>;
  listCommands(): Promise<Result<SlashCommandInfo[]>>;
  listMcp(): Promise<Result<McpServerInfo[]>>;
  setMcpEnabled(name: string, enabled: boolean): Promise<SimpleResult>;
  reconnectMcp(name: string): Promise<SimpleResult>;
  listSkills(): Promise<Result<SkillInfo[]>>;
  findFiles(q: string): Promise<Result<string[]>>;
  /** Buang cache model/command dan muat ulang skill di proses yang hidup. */
  reload(): Promise<SimpleResult>;
  /** Status MCP dari pesan `system/init`. */
  noteInitMcp(servers: unknown[]): void;
  /** Daftar command baru dari pesan `system/commands_changed`. */
  noteCommands(commands: SlashCommand[]): void;
}

export function createClaudeCatalog(deps: ClaudeCatalogDeps): ClaudeCatalog {
  const { cwd, env, now, runQuery, sharedOptions, liveQueries } = deps;

  /** Status MCP terakhir dari pesan `system/init` / request status. */
  let lastMcp: McpServerInfo[] = [];
  let modelsCache: { at: number; data: ModelOption[] } | null = null;
  let commandsCache: { at: number; data: SlashCommandInfo[] } | null = null;
  let fileCache: { at: number; files: string[] } | null = null;

  /** Query sementara (tanpa prompt) untuk request kontrol saat tidak ada proses. */
  async function withAnyQuery<T>(fn: (q: ClaudeQueryLike) => Promise<T>): Promise<T> {
    const live = liveQueries()[0];
    if (live) return withTimeout(fn(live), CONTROL_TIMEOUT_MS, "control request");
    const input = new InputQueue<SDKUserMessage>();
    const q = runQuery({ prompt: input, options: { ...sharedOptions(), persistSession: false } });
    // Stream harus dikonsumsi agar respons kontrol diproses.
    const drain = (async () => {
      try {
        for await (const _ of q) {
          // abaikan
        }
      } catch {
        // proses ditutup
      }
    })();
    try {
      return await withTimeout(fn(q), CONTROL_TIMEOUT_MS, "control request");
    } finally {
      input.close();
      q.close();
      void drain;
    }
  }

  async function listModels(): Promise<Result<ModelOption[]>> {
    if (modelsCache && now() - modelsCache.at < MODELS_CACHE_MS) {
      return { ok: true, data: modelsCache.data };
    }
    try {
      const models = await withAnyQuery((q) => q.supportedModels());
      const data = models.map((m): ModelOption => {
        const efforts = m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? []);
        return {
          providerID: CLAUDE_PROVIDER_ID,
          providerName: "Claude Code",
          modelID: m.value,
          name: m.displayName || m.value,
          ...(efforts.length > 0 ? { efforts } : {}),
          // Baris "Default (recommended)" = model Session tanpa pilihan.
          ...(m.value === "default" ? { isDefault: true } : {}),
        };
      });
      modelsCache = { at: now(), data };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `AGENT_LIST_MODELS_FAILED: ${(e as Error).message}` };
    }
  }

  async function listCommands(): Promise<Result<SlashCommandInfo[]>> {
    if (commandsCache && now() - commandsCache.at < MODELS_CACHE_MS) {
      return { ok: true, data: commandsCache.data };
    }
    try {
      const data = toCommandInfos(await withAnyQuery((q) => q.supportedCommands()));
      commandsCache = { at: now(), data };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `AGENT_LIST_COMMANDS_FAILED: ${(e as Error).message}` };
    }
  }

  async function listMcp(): Promise<Result<McpServerInfo[]>> {
    const q = liveQueries()[0];
    if (q) {
      try {
        lastMcp = toMcpInfos(
          await withTimeout(q.mcpServerStatus(), CONTROL_TIMEOUT_MS, "mcpServerStatus"),
        );
      } catch {
        // pakai status terakhir
      }
    }
    // Server terkonfigurasi tetap tampil walau belum ada proses `claude`
    // (status `unknown` sampai proses berjalan dan melaporkannya).
    const configured = await readClaudeMcpConfig(cwd, env);
    return { ok: true, data: mergeClaudeMcp(configured, lastMcp) };
  }

  /**
   * Request kontrol MCP ke SEMUA proses `claude` yang hidup — tiap proses
   * memegang koneksi MCP-nya sendiri. Berurutan, karena toggle di tiap proses
   * menulis perubahan yang sama ke `.claude.json`. Tanpa proses: query
   * sementara (toggle tetap tersimpan di config Project; reconnect menguji
   * koneksi) dan status server itu disimpan sebagai status terakhir.
   */
  async function mcpControl(
    name: string,
    label: string,
    fn: (q: ClaudeQueryLike) => Promise<void>,
  ): Promise<SimpleResult> {
    const live = liveQueries();
    let failure: Error | null = null;
    try {
      if (live.length === 0) {
        failure = await withAnyQuery(async (q) => {
          const err = await fn(q).then(
            () => null,
            (e: unknown) => e as Error,
          );
          // Hanya status server ini yang bermakna: server lain di proses
          // sementara bisa saja masih menyambung saat proses ditutup.
          const fresh = toMcpInfos(await q.mcpServerStatus()).find((s) => s.name === name);
          if (fresh) lastMcp = [...lastMcp.filter((s) => s.name !== name), fresh];
          return err;
        });
      }
      for (const q of live) {
        try {
          await withTimeout(fn(q), CONTROL_TIMEOUT_MS, label);
        } catch (e) {
          failure ??= e as Error;
        }
      }
    } catch (e) {
      failure ??= e as Error;
    }
    return failure === null
      ? { ok: true }
      : { ok: false, error: `AGENT_MCP_FAILED: ${failure.message}` };
  }

  async function projectFiles(): Promise<string[]> {
    if (fileCache && now() - fileCache.at < FILES_CACHE_MS) return fileCache.files;
    const files = await listProjectFiles(cwd);
    fileCache = { at: now(), files };
    return files;
  }

  return {
    listModels,
    listCommands,
    listMcp,
    setMcpEnabled: (name, enabled) =>
      mcpControl(name, "toggleMcpServer", (q) => q.toggleMcpServer(name, enabled)),
    reconnectMcp: (name) =>
      mcpControl(name, "reconnectMcpServer", (q) => q.reconnectMcpServer(name)),

    async listSkills() {
      try {
        return { ok: true, data: await listClaudeSkills(cwd, claudeGlobalSkillsDir(env)) };
      } catch (e) {
        return { ok: false, error: `AGENT_LIST_SKILLS_FAILED: ${(e as Error).message}` };
      }
    },

    async findFiles(q) {
      try {
        return { ok: true, data: rankFiles(await projectFiles(), q) };
      } catch (e) {
        return { ok: false, error: `AGENT_FIND_FILES_FAILED: ${(e as Error).message}` };
      }
    },

    async reload() {
      modelsCache = null;
      commandsCache = null;
      // Proses yang hidup memuat ulang skill tanpa restart (daftar command
      // baru tiba lewat `commands_changed`); proses baru membacanya sendiri.
      let failure: string | null = null;
      for (const q of liveQueries()) {
        try {
          await withTimeout(q.reloadSkills(), CONTROL_TIMEOUT_MS, "reloadSkills");
        } catch (e) {
          failure ??= (e as Error).message;
        }
      }
      return failure === null
        ? { ok: true }
        : { ok: false, error: `AGENT_RELOAD_FAILED: ${failure}` };
    },

    noteInitMcp(servers) {
      lastMcp = servers
        .filter((s): s is { name: string; status: string } => {
          return typeof (s as { name?: unknown } | null)?.name === "string";
        })
        .map((s) => ({ name: s.name, status: mcpStatus(String(s.status)), error: null }));
    },

    noteCommands(commands) {
      // Daftar berubah di tengah sesi (mis. skill baru ditemukan) — ganti cache.
      commandsCache = { at: now(), data: toCommandInfos(commands) };
    },
  };
}
