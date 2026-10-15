/**
 * Session opencode yang dibuat di luar KCG (`AgentClient.external`).
 *
 * TUI / desktop opencode dan KCG memakai background service opencode v2 yang
 * SAMA, jadi Session-nya sudah ada di store bersama — tidak ada transcript
 * yang perlu disalin; Session yang diimpor dilanjutkan dengan `prompt` biasa.
 * Modul ini hanya menyediakan daftar Session akar (bukan sub-agent / arsip)
 * untuk direktori Project, riwayat untuk timeline, dan fork.
 *
 * "Terbuka di tempat lain" = Session sedang menjalankan turn
 * (`session.active`): mengimpornya di tengah turn membuat sisa turn tercampur
 * dengan riwayat yang sudah disalin, jadi yang dilanjutkan salinannya.
 */
import { isOpencodeDefaultTitle } from "../../../lib/session-title";
import type { Result } from "../../result";
import type { AgentClient, AgentExternalSession } from "../types";
import type { OpencodeConnection } from "./connection";
import { historyFromMessages } from "./history";
import { errorMessage, list, type Rec, rec, str } from "./util";

/** Ukuran halaman `session.list` / `message.list`. */
const PAGE_SIZE = 100;
/** Batas Session yang dibaca (Session lama di luar batas tidak ditawarkan). */
const MAX_SESSIONS = 500;
/** Batas halaman riwayat (jaring pengaman cursor yang tidak maju). */
const MAX_MESSAGE_PAGES = 200;

/** Potong teks panjang untuk judul / cuplikan daftar. */
function snippet(text: string | undefined | null, max = 160): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function nextCursor(res: unknown): string | null {
  return str(rec(rec(res).cursor).next);
}

export function createOpencodeExternal(deps: {
  conn: OpencodeConnection;
  directory: string;
}): NonNullable<AgentClient["external"]> {
  const { conn, directory } = deps;

  /** Session akar untuk direktori, terbaru dulu (berhalaman). */
  async function sessions(): Promise<Rec[]> {
    const api = await conn.api();
    const out: Rec[] = [];
    let cursor: string | null = null;
    do {
      // Cursor membawa filter & urutannya sendiri (tidak boleh digabung `order`).
      const res: unknown = await api.session.list(
        cursor
          ? { cursor, limit: PAGE_SIZE }
          : { directory, parentID: null, order: "desc", limit: PAGE_SIZE },
      );
      const page = list(res).map(rec);
      out.push(...page);
      cursor = page.length < PAGE_SIZE ? null : nextCursor(res);
    } while (cursor && out.length < MAX_SESSIONS);
    return out;
  }

  /** Seluruh pesan Session, terlama dulu. */
  async function messages(sessionID: string): Promise<unknown[]> {
    const api = await conn.api();
    const out: unknown[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_MESSAGE_PAGES; i++) {
      const res: unknown = await api.message.list(
        cursor
          ? { sessionID, cursor, limit: PAGE_SIZE }
          : { sessionID, order: "asc", limit: PAGE_SIZE },
      );
      const page = list(res);
      out.push(...page);
      cursor = page.length < PAGE_SIZE ? null : nextCursor(res);
      if (!cursor) break;
    }
    return out;
  }

  /** Teks prompt user pertama (null = Session belum pernah dipakai). */
  async function firstPrompt(sessionID: string): Promise<string | null> {
    const api = await conn.api();
    const res = await api.message.list({ sessionID, order: "asc", limit: 1, type: "user" });
    const first = list(res).map(rec)[0];
    if (!first) return null;
    return typeof first.text === "string" ? first.text : "";
  }

  async function listSessions(): Promise<Result<AgentExternalSession[]>> {
    try {
      const api = await conn.api();
      const [infos, active] = await Promise.all([
        sessions(),
        api.session.active().then(rec, () => ({}) as Rec),
      ]);
      const rows = await Promise.all(
        infos.map(async (info): Promise<AgentExternalSession | null> => {
          const id = str(info.id);
          const time = rec(info.time);
          if (!id || str(info.parentID) || time.archived !== undefined) return null;
          const updatedAt = typeof time.updated === "number" ? time.updated : 0;
          const created = typeof time.created === "number" ? time.created : undefined;
          let title = snippet(str(info.title), 120);
          let prompt: string | undefined;
          // Judul default / tanpa model = mungkin belum pernah dipakai: cek
          // prompt pertama (Session kosong tidak ditawarkan).
          if (!title || isOpencodeDefaultTitle(title) || info.model === undefined) {
            const text = await firstPrompt(id);
            if (text === null) return null;
            prompt = snippet(text);
            if (!title || isOpencodeDefaultTitle(title)) title = snippet(text, 120);
          }
          return {
            id,
            title: title ?? "Untitled session",
            ...(prompt ? { firstPrompt: prompt } : {}),
            ...(created !== undefined ? { createdAt: created } : {}),
            updatedAt,
            openElsewhere: active[id] !== undefined,
            source: "opencode",
          };
        }),
      );
      const data = rows
        .filter((r): r is AgentExternalSession => r !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: `AGENT_EXTERNAL_LIST_FAILED: ${errorMessage(e)}` };
    }
  }

  return {
    list: listSessions,
    async history(sessionID) {
      try {
        return { ok: true, data: historyFromMessages(await messages(sessionID)) };
      } catch (e) {
        return { ok: false, error: `AGENT_EXTERNAL_HISTORY_FAILED: ${errorMessage(e)}` };
      }
    },
    async fork(sessionID) {
      const res = await conn.call("AGENT_FORK_FAILED", (a) => a.session.fork({ sessionID }));
      if (!res.ok) return res;
      const id = str(rec(res.data).id);
      return id ? { ok: true, data: { id } } : { ok: false, error: "AGENT_FORK_FAILED" };
    },
  };
}
