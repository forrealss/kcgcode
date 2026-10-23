/**
 * Backend opencode v2 — `@opencode/client` + background service resmi.
 *
 * - SATU service opencode (`Service.ensure()` -> `opencode serve --service`,
 *   dipakai bersama aplikasi opencode lain milik user) melayani seluruh
 *   Project: Session v2 terikat `location.directory`, jadi tidak ada lagi
 *   server per Project, parsing port, atau health check manual.
 * - Satu langganan event untuk semua Project; tiap event dirutekan ke client
 *   Project berdasarkan direktori Session-nya.
 * - Langganan v2 bersifat live-only tanpa reconnect otomatis: bila putus,
 *   service di-ensure ulang. Bila service-nya berganti (pid berbeda) turn
 *   yang berjalan hilang -> `onLost` untuk tiap Project.
 * - Client per Project stabil selama backend hidup (tidak diganti saat
 *   reconnect), sehingga langganan Session_Manager tetap menempel.
 *
 * Rincian dipecah ke modul saudara: `api` (subset client + konektor),
 * `connection` (koneksi & reconnect), `events` (perutean event & todo),
 * `usage` (pemakaian context), `catalog` (daftar per Project), dan
 * `session` (operasi Session).
 */
import path from "node:path";
import type { AgentBackend, AgentClient } from "../types";
import { defaultConnector, type OpencodeConnector } from "./api";
import { createOpencodeCatalog, type OpencodeCatalog } from "./catalog";
import { OpencodeConnection } from "./connection";
import { OpencodeEvents } from "./events";
import { createOpencodeExternal } from "./external";
import { createOpencodeSession } from "./session";
import { OpencodeUsage } from "./usage";
import { directoryKey } from "./util";
import type { VersionProbe } from "./version";

export type { OpencodeApi } from "./api";
export { directoryKey, parseSlashCommand } from "./util";

export interface OpencodeBackendOptions {
  connect?: OpencodeConnector;
  versionProbe?: VersionProbe;
  /** Jeda awal reconnect (ms); berlipat sampai `maxReconnectDelayMs`. */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export function createOpencodeBackend(opts: OpencodeBackendOptions = {}): AgentBackend {
  /** Client per Project. */
  const clients = new Map<
    string,
    { client: AgentClient; dirKey: string; catalog: OpencodeCatalog }
  >();
  const lostCbs = new Set<(projectId: string) => void>();
  const usage = new OpencodeUsage();
  const events = new OpencodeEvents(usage);
  const conn = new OpencodeConnection({
    connector: opts.connect ?? defaultConnector,
    versionProbe: opts.versionProbe,
    baseDelay: opts.reconnectDelayMs ?? 1000,
    maxDelay: opts.maxReconnectDelayMs ?? 30_000,
    onEvent: (raw) => events.dispatch(raw),
    onLost: () => {
      for (const projectId of clients.keys()) {
        for (const cb of lostCbs) cb(projectId);
      }
    },
  });

  function createClient(directory: string): { client: AgentClient; catalog: OpencodeCatalog } {
    const dirKey = directoryKey(directory);
    const catalog = createOpencodeCatalog({ conn, directory, usage });
    const client: AgentClient = {
      kind: "opencode",
      directory,
      capabilities: { skillReload: true, permissionModes: [] },
      session: createOpencodeSession({ conn, directory, dirKey, events, usage, catalog }),
      permission: {
        reply: ({ sessionID, requestID, decision }) =>
          conn.reply("AGENT_PERMISSION_REPLY_FAILED", (a) =>
            a.permission.reply({ sessionID, requestID, decision }),
          ),
      },
      form: {
        reply: ({ sessionID, formID, answer }) =>
          conn.reply("AGENT_FORM_REPLY_FAILED", (a) =>
            a.session.form.reply({ sessionID, formID, answer }),
          ),
        cancel: ({ sessionID, formID }) =>
          conn.reply("AGENT_FORM_CANCEL_FAILED", (a) =>
            a.session.form.cancel({ sessionID, formID }),
          ),
      },
      model: catalog.model,
      agent: catalog.agent,
      mcp: catalog.mcp,
      skill: catalog.skill,
      command: catalog.command,
      file: catalog.file,
      vcs: catalog.vcs,
      location: catalog.location,
      event: {
        subscribe: (cb) => events.subscribe(dirKey, cb),
      },
      external: createOpencodeExternal({ conn, directory }),
    };
    return { client, catalog };
  }

  /** MCP kcgcode di service milik pengguna dicabut (best-effort, maks 2 dtk). */
  async function unregister(catalog: OpencodeCatalog): Promise<void> {
    await Promise.race([catalog.unregisterAll().catch(() => {}), Bun.sleep(2000)]);
  }

  return {
    kind: "opencode",
    async ensure(projectId, directory) {
      const res = await conn.connect();
      if (!res.ok) return { ok: false, error: res.error };
      const dirKey = directoryKey(directory);
      const cur = clients.get(projectId);
      if (cur && cur.dirKey === dirKey) return { ok: true, data: cur.client };
      if (cur) void unregister(cur.catalog);
      const { client, catalog } = createClient(path.resolve(directory));
      clients.set(projectId, { client, dirKey, catalog });
      return { ok: true, data: client };
    },
    get(projectId) {
      return clients.get(projectId)?.client;
    },
    async release(projectId) {
      const cur = clients.get(projectId);
      clients.delete(projectId);
      if (cur) await unregister(cur.catalog);
    },
    async shutdown() {
      // Service opencode milik user (dipakai bersama aplikasi lain) tidak
      // dimatikan — cukup cabut MCP kcgcode dan lepas langganan event.
      await Promise.all([...clients.values()].map((c) => unregister(c.catalog)));
      conn.stop();
      clients.clear();
    },
    onLost(cb) {
      lostCbs.add(cb);
    },
  };
}
