/**
 * Backend opencode (`backend.ts` / `connection.ts`) dengan API palsu: satu
 * koneksi untuk semua Project, perutean event per direktori Session, dan
 * reconnect saat langganan event putus.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { AgentEvent } from "../../types";
import { directoryKey } from "../backend";
import { OPENCODE_UPGRADE_REQUIRED } from "../version";
import { OTHER, PROJ, setup, tick } from "./harness";

describe("createOpencodeBackend", () => {
  test("CLI v1 -> ensure gagal dengan OPENCODE_UPGRADE_REQUIRED", async () => {
    const { backend, apis } = setup({ version: "1.4.3" });
    expect(await backend.ensure("p1", PROJ)).toEqual({
      ok: false,
      error: `${OPENCODE_UPGRADE_REQUIRED}: 1.4.3`,
    });
    expect(apis).toHaveLength(0); // service v2 tidak disentuh
  });

  test("satu koneksi untuk semua Project; client stabil per Project", async () => {
    const { backend, apis } = setup();
    const a = await backend.ensure("p1", PROJ);
    const b = await backend.ensure("p2", OTHER);
    const a2 = await backend.ensure("p1", PROJ);
    if (!a.ok || !b.ok || !a2.ok) throw new Error("ensure");
    expect(apis).toHaveLength(1);
    expect(a2.data).toBe(a.data);
    expect(backend.get("p2")).toBe(b.data);
  });

  test("event dirutekan ke client sesuai direktori Session", async () => {
    const { backend, apis } = setup();
    const a = await backend.ensure("p1", PROJ);
    const b = await backend.ensure("p2", OTHER);
    if (!a.ok || !b.ok) throw new Error("ensure");
    const evA: AgentEvent[] = [];
    const evB: AgentEvent[] = [];
    a.data.event.subscribe((e) => evA.push(e));
    b.data.event.subscribe((e) => evB.push(e));
    const created = await a.data.session.create();
    if (!created.ok) throw new Error("create");

    const api = apis[0];
    // Event dengan location direktori lain -> hanya ke client itu.
    api?.push({
      type: "session.text.delta",
      location: { directory: OTHER },
      data: { sessionID: "ses_other", assistantMessageID: "m", ordinal: 0, delta: "x" },
    });
    // Event TANPA location milik Session yang dibuat client A -> ke A.
    api?.push({ type: "session.execution.succeeded", data: { sessionID: "ses_new" } });
    // Session asing (aplikasi opencode lain) tanpa location -> dibuang.
    api?.push({ type: "session.execution.succeeded", data: { sessionID: "ses_asing" } });
    await tick();
    expect(evA.map((e) => e.type)).toEqual(["session.execution.succeeded"]);
    expect(evB.map((e) => e.type)).toEqual(["session.text.delta"]);
  });

  test("langganan putus: service sama -> sambung ulang tanpa onLost; service baru -> onLost", async () => {
    const { backend, apis } = setup({ pids: [100, 100, 200] });
    const r = await backend.ensure("p1", PROJ);
    if (!r.ok) throw new Error("ensure");
    const lost: string[] = [];
    backend.onLost((id) => lost.push(id));
    const events: AgentEvent[] = [];
    r.data.event.subscribe((e) => events.push(e));

    apis[0]?.drop();
    await tick();
    await tick();
    expect(apis).toHaveLength(2);
    expect(lost).toEqual([]);
    // Client lama tetap menerima event dari koneksi baru.
    apis[1]?.push({
      type: "session.execution.succeeded",
      location: { directory: PROJ },
      data: { sessionID: "ses_1" },
    });
    await tick();
    expect(events.map((e) => e.type)).toEqual(["session.execution.succeeded"]);

    apis[1]?.drop();
    await tick();
    await tick();
    expect(apis).toHaveLength(3);
    expect(lost).toEqual(["p1"]);
    await backend.shutdown();
  });

  test("directoryKey menyamakan pemisah & (Windows) huruf besar/kecil", () => {
    expect(directoryKey(PROJ)).toBe(directoryKey(`${PROJ}${path.sep}`));
    if (process.platform === "win32")
      expect(directoryKey("C:\\Proj")).toBe(directoryKey("c:/proj"));
  });
});
