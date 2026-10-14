/**
 * Operasi Session opencode per Project: buat/hapus, pilihan model/agent/
 * instruksi (diterapkan hanya bila berubah), prompt + slash command, dan
 * task list / pemakaian context dari state event.
 */
import type { AgentClient, ModelSelection } from "../types";
import { AGENT_REQUEST_GONE } from "../types";
import { COMPACT_COMMAND, type OpencodeCatalog } from "./catalog";
import type { OpencodeConnection } from "./connection";
import type { OpencodeEvents } from "./events";
import type { OpencodeUsage } from "./usage";
import { directoryKey, errorMessage, ok, parseSlashCommand, type Rec, rec, str } from "./util";

/** Kunci instruksi Project yang dipasang KCG pada Session opencode. */
export const INSTRUCTIONS_KEY = "kcg-project";

export function createOpencodeSession(deps: {
  conn: OpencodeConnection;
  directory: string;
  dirKey: string;
  events: OpencodeEvents;
  usage: OpencodeUsage;
  catalog: OpencodeCatalog;
}): AgentClient["session"] {
  const { conn, directory, dirKey, events, usage, catalog } = deps;
  const location = { location: { directory } };
  /** Pilihan terakhir yang sudah diterapkan per Session (hindari RPC berulang). */
  const applied = new Map<
    string,
    { model?: string; effort?: string; agent?: string; instructions?: string | null }
  >();
  const appliedFor = (sessionID: string) => {
    let a = applied.get(sessionID);
    if (!a) {
      a = {};
      applied.set(sessionID, a);
    }
    return a;
  };

  return {
    async create(input = {}) {
      const res = await conn.call("AGENT_CREATE_SESSION_FAILED", (a) =>
        a.session.create({ ...location, ...(input.title ? { title: input.title } : {}) }),
      );
      if (!res.ok) return res;
      const info = rec(res.data);
      const id = str(info.id);
      if (!id) return { ok: false, error: "AGENT_CREATE_SESSION_FAILED" };
      events.bindSession(id, dirKey);
      return { ok: true, data: { id, title: str(info.title) ?? undefined, directory } };
    },
    async get(sessionID) {
      try {
        const info = rec(await (await conn.api()).session.get({ sessionID }));
        const dir = str(rec(info.location).directory);
        events.bindSession(sessionID, dir ? directoryKey(dir) : dirKey);
        return {
          ok: true,
          data: { id: sessionID, title: str(info.title) ?? undefined, directory },
        };
      } catch (e) {
        return { ok: false, error: `AGENT_SESSION_NOT_FOUND: ${errorMessage(e)}` };
      }
    },
    async remove(sessionID) {
      applied.delete(sessionID);
      events.forgetTodos(sessionID);
      const res = await conn.reply("AGENT_DELETE_SESSION_FAILED", (a) =>
        a.session.remove({ sessionID }),
      );
      // Session sudah tidak ada = tujuan tercapai.
      return res.ok || res.error === AGENT_REQUEST_GONE ? { ok: true } : res;
    },
    async switchModel(sessionID, model: ModelSelection | null, effort = null) {
      const a = appliedFor(sessionID);
      const want = model ? `${model.providerID}/${model.modelID}` : undefined;
      const wantEffort = effort ?? undefined;
      // `null` tanpa effort = default: hanya perlu kembali bila sebelumnya diganti.
      if (a.model === want && a.effort === wantEffort) return { ok: true };
      let ref: Rec;
      if (model) {
        ref = { id: model.modelID, providerID: model.providerID };
      } else {
        const def = await conn.call("AGENT_SWITCH_MODEL_FAILED", (x) => x.model.default(location));
        if (!def.ok) return def;
        const info = rec(rec(def.data).data);
        ref = { id: info.id, providerID: info.providerID };
      }
      // Thinking effort opencode = variant model (`ModelRef.variant`).
      const res = await conn.call("AGENT_SWITCH_MODEL_FAILED", (x) =>
        x.session.switchModel({
          sessionID,
          model: { ...ref, ...(wantEffort ? { variant: wantEffort } : {}) },
        }),
      );
      if (res.ok) {
        a.model = want;
        a.effort = wantEffort;
      }
      return ok(res);
    },
    async switchAgent(sessionID, agent) {
      const a = appliedFor(sessionID);
      const want = agent ?? undefined;
      if (a.agent === want) return { ok: true };
      let target = agent;
      if (!target) {
        if (a.agent === undefined) return { ok: true };
        const agents = await catalog.agent.list();
        target = agents.ok ? (agents.data[0]?.name ?? null) : null;
        if (!target) return { ok: false, error: "AGENT_SWITCH_AGENT_FAILED" };
      }
      const res = await conn.call("AGENT_SWITCH_AGENT_FAILED", (x) =>
        x.session.switchAgent({ sessionID, agent: target }),
      );
      if (res.ok) a.agent = want;
      return ok(res);
    },
    async instructions(sessionID, text) {
      const a = appliedFor(sessionID);
      const want = text?.trim() ? text : null;
      if (a.instructions === want || (a.instructions === undefined && want === null)) {
        return { ok: true };
      }
      const res = await conn.reply("AGENT_INSTRUCTIONS_FAILED", (x) =>
        want === null
          ? x.session.instructions.entry.remove({ sessionID, key: INSTRUCTIONS_KEY })
          : x.session.instructions.entry.put({ sessionID, key: INSTRUCTIONS_KEY, value: want }),
      );
      if (res.ok || (want === null && res.error === AGENT_REQUEST_GONE)) {
        a.instructions = want;
        return { ok: true };
      }
      return res;
    },
    async prompt(input) {
      events.bindSession(input.sessionID, dirKey);
      const files = input.files?.length
        ? { files: input.files.map((f) => ({ uri: f.uri, name: f.name })) }
        : {};
      // `/nama args` milik opencode dijalankan lewat `session.command`
      // (TUI opencode melakukan hal yang sama); `/usr/bin …` dsb. tetap teks.
      const slash = parseSlashCommand(input.text);
      // Compact memakai API compact opencode (berjalan sebagai eksekusi
      // biasa: execution.started -> compaction.* -> execution.succeeded).
      if (slash?.name === COMPACT_COMMAND.name) {
        return ok(
          await conn.call("AGENT_PROMPT_FAILED", (a) =>
            a.session.compact({ sessionID: input.sessionID }),
          ),
        );
      }
      if (slash && (await catalog.isCommand(slash.name))) {
        const res = await conn.call("AGENT_PROMPT_FAILED", (a) =>
          a.session.command({
            sessionID: input.sessionID,
            name: slash.name,
            text: slash.args,
            ...files,
          }),
        );
        return ok(res);
      }
      const res = await conn.call("AGENT_PROMPT_FAILED", (a) =>
        a.session.prompt({ sessionID: input.sessionID, text: input.text, ...files }),
      );
      return ok(res);
    },
    async interrupt(sessionID) {
      return ok(await conn.call("AGENT_ABORT_FAILED", (a) => a.session.interrupt({ sessionID })));
    },
    // opencode v2 tidak punya permission mode tingkat Session (izin diatur
    // lewat agent & config) — hanya `null` (tanpa pilihan) yang diterima.
    async setPermissionMode(_sessionID, mode) {
      return mode === null
        ? { ok: true }
        : { ok: false, error: "AGENT_PERMISSION_MODE_UNSUPPORTED" };
    },
    async todos(sessionID) {
      return { ok: true, data: events.todosOf(sessionID) };
    },
    async contextUsage(sessionID) {
      return { ok: true, data: await usage.contextUsage(sessionID, () => catalog.model.list()) };
    },
  };
}
