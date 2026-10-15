/**
 * Session opencode buatan TUI / desktop lewat adapter (`client.external`)
 * dengan API palsu: daftar Session akar per direktori, riwayat berhalaman,
 * dan fork.
 */
import { describe, expect, test } from "bun:test";
import type { AgentClient } from "../../types";
import { PROJ, setup } from "./harness";

async function ready() {
  const { backend, apis } = setup();
  const r = await backend.ensure("p1", PROJ);
  if (!r.ok) throw new Error("ensure");
  const fake = apis[0];
  if (!fake) throw new Error("api");
  return { client: r.data as AgentClient, fake, ext: r.data.external };
}

function ses(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    model: { id: "m", providerID: "p" },
    time: { created: 1, updated: 10 },
    location: { directory: PROJ },
    ...extra,
  };
}

describe("client.external (opencode)", () => {
  test("list: Session akar non-arsip, judul default dari prompt pertama, kosong dibuang", async () => {
    const { fake, ext } = await ready();
    fake.api.session.list = async (input) => {
      fake.calls.push(["session.list", input]);
      return {
        data: [
          ses("ses_a", { time: { created: 1, updated: 50 } }),
          ses("ses_child", { parentID: "ses_a" }),
          ses("ses_arch", { time: { created: 1, updated: 99, archived: 98 } }),
          ses("ses_def", {
            title: "New session - 2026-10-02T12:17:20.023Z",
            time: { created: 5, updated: 70 },
          }),
          ses("ses_empty", { title: "sse test", model: undefined }),
        ],
        cursor: { next: "c1" },
      };
    };
    fake.api.session.active = async () => ({ ses_a: { type: "running" } });
    fake.api.message.list = async (input) => {
      fake.calls.push(["message.list", input]);
      const sid = (input as { sessionID: string }).sessionID;
      return {
        data: sid === "ses_def" ? [{ id: "m1", type: "user", text: "  please\n fix   it " }] : [],
        cursor: {},
      };
    };

    const res = await ext?.list();
    expect(res).toEqual({
      ok: true,
      data: [
        {
          id: "ses_def",
          title: "please fix it",
          firstPrompt: "please fix it",
          createdAt: 5,
          updatedAt: 70,
          openElsewhere: false,
          source: "opencode",
        },
        {
          id: "ses_a",
          title: "Title ses_a",
          createdAt: 1,
          updatedAt: 50,
          openElsewhere: true,
          source: "opencode",
        },
      ],
    });
    // Filter direktori + akar dikirim ke service; halaman < limit -> berhenti.
    expect(fake.calls.filter(([n]) => n === "session.list")).toEqual([
      ["session.list", { directory: PROJ, parentID: null, order: "desc", limit: 100 }],
    ]);
    // Prompt pertama hanya dicek untuk judul default / Session tanpa model.
    expect(
      fake.calls
        .filter(([n]) => n === "message.list")
        .map(([, i]) => (i as { sessionID: string }).sessionID),
    ).toEqual(["ses_def", "ses_empty"]);
  });

  test("list: halaman berikutnya lewat cursor saja (tanpa order)", async () => {
    const { fake, ext } = await ready();
    const page1 = Array.from({ length: 100 }, (_, i) => ses(`ses_${i}`));
    fake.api.session.list = async (input) => {
      fake.calls.push(["session.list", input]);
      const cursor = (input as { cursor?: string }).cursor;
      return cursor
        ? { data: [ses("ses_last")], cursor: { next: "c2" } }
        : { data: page1, cursor: { next: "c1" } };
    };
    const res = await ext?.list();
    expect(res?.ok && res.data.length).toBe(101);
    expect(fake.calls.filter(([n]) => n === "session.list").at(-1)).toEqual([
      "session.list",
      { cursor: "c1", limit: 100 },
    ]);
  });

  test("list: service gagal -> AGENT_EXTERNAL_LIST_FAILED; active gagal diabaikan", async () => {
    const { fake, ext } = await ready();
    fake.errors.set("session.active", new Error("nope"));
    fake.api.session.list = async () => ({ data: [ses("ses_a")], cursor: {} });
    expect(await ext?.list()).toMatchObject({
      ok: true,
      data: [{ id: "ses_a", openElsewhere: false }],
    });
    fake.api.session.list = async () => {
      throw new Error("down");
    };
    expect(await ext?.list()).toEqual({ ok: false, error: "AGENT_EXTERNAL_LIST_FAILED: down" });
  });

  test("history: seluruh halaman message.list diterjemahkan", async () => {
    const { fake, ext } = await ready();
    const first = Array.from({ length: 100 }, (_, i) => ({
      id: `msg_${String(i).padStart(3, "0")}`,
      type: "user",
      time: { created: i },
      text: `p${i}`,
    }));
    fake.api.message.list = async (input) => {
      fake.calls.push(["message.list", input]);
      return (input as { cursor?: string }).cursor
        ? {
            data: [
              {
                id: "msg_a",
                type: "assistant",
                time: { created: 200 },
                content: [{ type: "text", text: "done" }],
              },
            ],
            cursor: { next: "c2" },
          }
        : { data: first, cursor: { next: "c1" } };
    };
    const res = await ext?.history("ses_a");
    if (!res?.ok) throw new Error("history");
    expect(res.data).toHaveLength(101);
    expect(res.data.at(-1)).toMatchObject({ id: "msg_a", role: "assistant" });
    expect(fake.calls.filter(([n]) => n === "message.list").map(([, i]) => i)).toEqual([
      { sessionID: "ses_a", order: "asc", limit: 100 },
      { sessionID: "ses_a", cursor: "c1", limit: 100 },
    ]);

    fake.api.message.list = async () => {
      throw new Error("gone");
    };
    expect(await ext?.history("ses_a")).toEqual({
      ok: false,
      error: "AGENT_EXTERNAL_HISTORY_FAILED: gone",
    });
  });

  test("fork: id Session salinan", async () => {
    const { fake, ext } = await ready();
    expect(await ext?.fork("ses_a")).toEqual({ ok: true, data: { id: "ses_fork" } });
    expect(fake.calls.find(([n]) => n === "session.fork")).toEqual([
      "session.fork",
      { sessionID: "ses_a" },
    ]);
    fake.errors.set("session.fork", new Error("busy"));
    expect(await ext?.fork("ses_a")).toEqual({ ok: false, error: "AGENT_FORK_FAILED: busy" });
  });
});
