/**
 * Katalog per Project yang tidak terikat satu Session: daftar model, agent,
 * MCP, skill, slash command, file, status VCS, dan reload lokasi. Respons
 * longgar `@opencode/client` dipetakan ke tipe tampilan KCG.
 */
import path from "node:path";
import type {
  AgentOption,
  FileChange,
  McpServerInfo,
  ModelOption,
  SkillInfo,
  SlashCommandInfo,
} from "../../../types";
import type { Result } from "../../result";
import type { AgentClient } from "../types";
import type { OpencodeConnection } from "./connection";
import type { OpencodeUsage } from "./usage";
import { directoryKey, list, ok, rec, str } from "./util";

/** Umur cache nama slash command (rute prompt `/nama`) per Project. */
const COMMANDS_CACHE_MS = 60_000;

/**
 * `/compact` — opencode tidak mendaftarkannya sebagai command, tapi punya
 * API compact sendiri (`session.compact`); ditawarkan di autocomplete dan
 * dirutekan ke API itu.
 */
export const COMPACT_COMMAND: SlashCommandInfo = {
  name: "compact",
  description: "Summarize the conversation so far to free up context",
  argumentHint: null,
  builtin: true,
};

const MCP_STATUSES = new Set<McpServerInfo["status"]>([
  "connected",
  "pending",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
]);

export type OpencodeCatalog = Pick<
  AgentClient,
  "model" | "agent" | "mcp" | "skill" | "command" | "file" | "vcs" | "location"
> & {
  /** Nama `/nama` dikenal opencode? Daftar gagal dimuat -> dianggap teks biasa. */
  isCommand(name: string): Promise<boolean>;
  /** Cabut MCP yang didaftarkan kcgcode (`mcp.register`) dari service. */
  unregisterAll(): Promise<void>;
};

export function createOpencodeCatalog(deps: {
  conn: OpencodeConnection;
  directory: string;
  usage: OpencodeUsage;
}): OpencodeCatalog {
  const { conn, directory, usage } = deps;
  const location = { location: { directory } };
  /** Slash command terakhir (untuk merutekan prompt `/nama`). */
  let commandsCache: { at: number; names: Set<string> } | null = null;
  /** MCP yang didaftarkan kcgcode lewat `mcp.add` di direktori ini. */
  const registered = new Set<string>();

  async function listCommands(): Promise<Result<SlashCommandInfo[]>> {
    const res = await conn.call("AGENT_LIST_COMMANDS_FAILED", (a) => a.command.list(location));
    if (!res.ok) return res;
    const out: SlashCommandInfo[] = [];
    for (const raw of list(res.data)) {
      const c = rec(raw);
      const name = str(c.name);
      if (!name) continue;
      out.push({ name, description: str(c.description), argumentHint: null });
    }
    if (!out.some((c) => c.name === COMPACT_COMMAND.name)) out.push(COMPACT_COMMAND);
    out.sort((x, y) => x.name.localeCompare(y.name));
    commandsCache = { at: Date.now(), names: new Set(out.map((c) => c.name)) };
    return { ok: true, data: out };
  }

  return {
    async unregisterAll() {
      const names = [...registered];
      registered.clear();
      await Promise.all(
        names.map((server) =>
          conn.call("AGENT_MCP_FAILED", (a) => a.mcp.remove({ ...location, server })),
        ),
      );
    },
    async isCommand(name) {
      if (!commandsCache || Date.now() - commandsCache.at > COMMANDS_CACHE_MS) {
        await listCommands();
      }
      return commandsCache?.names.has(name) ?? false;
    },
    model: {
      async list() {
        const res = await conn.call("AGENT_LIST_MODELS_FAILED", (a) =>
          Promise.all([
            a.model.list(location),
            a.provider.list(location).catch(() => null),
            a.model.default(location).catch(() => null),
          ]),
        );
        if (!res.ok) return res;
        const [models, providers, fallback] = res.data;
        const def = rec(rec(fallback).data);
        const names = new Map<string, string>();
        for (const p of list(providers)) {
          const id = str(rec(p).id);
          if (id) names.set(id, str(rec(p).name) ?? id);
        }
        const out: ModelOption[] = [];
        for (const raw of list(models)) {
          const m = rec(raw);
          const id = str(m.id);
          const providerID = str(m.providerID);
          if (!id || !providerID) continue;
          const limit = rec(m.limit).context;
          if (typeof limit === "number" && limit > 0) {
            usage.setContextLimit(`${providerID}/${id}`, limit);
          }
          if (m.enabled === false || m.status === "deprecated") continue;
          const efforts = (Array.isArray(m.variants) ? m.variants : [])
            .map((v) => str(rec(v).id))
            .filter((v): v is string => v !== null);
          out.push({
            providerID,
            providerName: names.get(providerID) ?? providerID,
            modelID: id,
            name: str(m.name) ?? id,
            ...(efforts.length > 0 ? { efforts } : {}),
            ...(def.id === id && def.providerID === providerID ? { isDefault: true } : {}),
          });
        }
        usage.markLimitsLoaded();
        return { ok: true, data: out };
      },
    },
    agent: {
      async list() {
        const res = await conn.call("AGENT_LIST_AGENTS_FAILED", (a) => a.agent.list(location));
        if (!res.ok) return res;
        const out: AgentOption[] = [];
        for (const raw of list(res.data)) {
          const ag = rec(raw);
          const id = str(ag.id);
          // Subagent murni & agent tersembunyi bukan mode percakapan.
          if (!id || ag.mode === "subagent" || ag.hidden === true) continue;
          out.push({
            name: id,
            mode: ag.mode === "all" ? "all" : "primary",
            description: str(ag.description),
          });
        }
        return { ok: true, data: out };
      },
    },
    mcp: {
      async list() {
        const res = await conn.call("AGENT_LIST_MCP_FAILED", (a) => a.mcp.list(location));
        if (!res.ok) return res;
        const out: McpServerInfo[] = [];
        for (const raw of list(res.data)) {
          const m = rec(raw);
          const name = str(m.name);
          if (!name) continue;
          const st = rec(m.status);
          const status = MCP_STATUSES.has(st.status as McpServerInfo["status"])
            ? (st.status as McpServerInfo["status"])
            : "unknown";
          out.push({ name, status, error: str(st.error) });
        }
        return { ok: true, data: out.sort((x, y) => x.name.localeCompare(y.name)) };
      },
      // Disconnect = status `disabled` di service (tidak menulis config).
      async setEnabled(name, enabled) {
        const input = { ...location, server: name };
        return ok(
          await conn.call("AGENT_MCP_FAILED", (a) =>
            enabled ? a.mcp.connect(input) : a.mcp.disconnect(input),
          ),
        );
      },
      async reconnect(name) {
        return ok(
          await conn.call("AGENT_MCP_FAILED", (a) => a.mcp.connect({ ...location, server: name })),
        );
      },
      // `mcp.add` menyimpan server di memori service untuk direktori ini saja
      // (hilang saat service restart / `location.reload`) — tidak menulis
      // config pengguna atau Project. Konfigurasi sama -> tanpa reconnect.
      async register(name, server) {
        const res = ok(
          await conn.call("AGENT_MCP_FAILED", (a) =>
            a.mcp.add({
              ...location,
              server: name,
              config: { type: "remote", url: server.url, headers: server.headers },
            }),
          ),
        );
        if (res.ok) registered.add(name);
        return res;
      },
    },
    skill: {
      async list() {
        const res = await conn.call("AGENT_LIST_SKILLS_FAILED", (a) => a.skill.list(location));
        if (!res.ok) return res;
        const root = directoryKey(directory);
        const out: SkillInfo[] = [];
        for (const raw of list(res.data)) {
          const s = rec(raw);
          const name = str(s.id) ?? str(s.name);
          if (!name) continue;
          const loc = str(s.path);
          const builtin = loc === null || loc.startsWith("/builtin/");
          const key = loc ? directoryKey(loc) : "";
          const source = builtin
            ? "builtin"
            : key === root || key.startsWith(root + path.sep)
              ? "project"
              : "global";
          out.push({
            name,
            description: str(s.description),
            location: builtin ? null : loc,
            source,
          });
        }
        return { ok: true, data: out.sort((x, y) => x.name.localeCompare(y.name)) };
      },
    },
    command: { list: listCommands },
    file: {
      async find(query) {
        const res = await conn.call("AGENT_FIND_FILES_FAILED", (a) =>
          a.file.find({ ...location, query, type: "file", limit: 50 }),
        );
        if (!res.ok) return res;
        const out: string[] = [];
        for (const raw of list(res.data)) {
          const p = str(rec(raw).path);
          if (p) out.push(p);
        }
        return { ok: true, data: out };
      },
    },
    vcs: {
      async status() {
        const res = await conn.call("AGENT_FILE_STATUS_FAILED", (a) => a.vcs.status(location));
        if (!res.ok) return res;
        const out: FileChange[] = [];
        for (const raw of list(res.data)) {
          const f = rec(raw);
          const file = str(f.file);
          if (!file) continue;
          const status = f.status === "added" || f.status === "deleted" ? f.status : "modified";
          out.push({
            path: file,
            added: typeof f.additions === "number" ? f.additions : 0,
            removed: typeof f.deletions === "number" ? f.deletions : 0,
            status,
          });
        }
        return { ok: true, data: out };
      },
    },
    location: {
      async reload() {
        return ok(await conn.call("AGENT_RELOAD_FAILED", (a) => a.location.reload(location)));
      },
    },
  };
}
