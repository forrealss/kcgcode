/**
 * Integration test end-to-end alur utama (task 20.2) + wiring otentikasi.
 *
 * Skenario dengan `PtyHandle` mock:
 * buat Project (POST /api/projects) -> buat Session (POST /api/sessions)
 * -> `attach` via WebSocket -> terima `output` -> respon Interactive_Prompt
 * -> `stopSession` (DELETE /api/sessions/:id).
 *
 * Server nyata (`Bun.serve` via `createKcgServer`) + WebSocket client nyata;
 * hanya `PtyHandle` yang di-mock sesuai batasan mocking `design.md`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKcgServer, type KcgServer } from "../app";
import { openSessionStore, type SessionStore } from "../db";
import type { PtyHandle } from "../pty-process";
import type { Project, Session } from "../types";
import type { ServerMessage } from "../ws-protocol";

// ---------------------------------------------------------------------------
// Mock PtyHandle
// ---------------------------------------------------------------------------

interface PtyMock extends PtyHandle {
  writes: string[];
  kills: string[];
  emitData(chunk: string): void;
  emitExit(code: number | null): void;
}

function makePtyMock(sessionId: string): PtyMock {
  const writes: string[] = [];
  const kills: string[] = [];
  let dataCb: ((chunk: string) => void) | null = null;
  let exitCb: ((code: number | null, expected: boolean) => void) | null = null;
  let killRequested = false;

  return {
    sessionId,
    writes,
    kills,
    write(data: string) {
      writes.push(data);
    },
    resize() {},
    kill(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
      kills.push(signal);
      killRequested = true;
    },
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    emitData(chunk: string) {
      dataCb?.(chunk);
    },
    emitExit(code: number | null) {
      exitCb?.(code, killRequested);
    },
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 3000, label = "kondisi"): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout menunggu ${label}`);
    await Bun.sleep(10);
  }
}

describe("createKcgServer — alur utama e2e", () => {
  let store: SessionStore;
  let app: KcgServer;
  let root: string;
  let handles: Map<string, PtyMock>;

  beforeAll(() => {
    store = openSessionStore(":memory:");
    root = mkdtempSync(path.join(tmpdir(), "kcg-e2e-"));
    mkdirSync(path.join(root, "proj"), { recursive: true });
    handles = new Map<string, PtyMock>();
    app = createKcgServer({
      config: { sandboxRoot: root, configPath: "test" },
      auth: { hostname: "127.0.0.1", authEnabled: false, authToken: "" },
      store,
      port: 0,
      spawn: (_cmd, _cwd, sessionId) => {
        const h = makePtyMock(sessionId);
        handles.set(sessionId, h);
        return h;
      },
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  function baseUrl(): string {
    return `http://127.0.0.1:${app.server.port}`;
  }

  test("20.2: project -> session -> attach -> output -> prompt -> stop", async () => {
    // ---- buat Project (Requirement 10.4) ----
    const projRes = await fetch(`${baseUrl()}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", path: "proj" }),
    });
    expect(projRes.status).toBe(201);
    const projBody = (await projRes.json()) as { project: Project };
    expect(projBody.project.path.endsWith("proj")).toBe(true);

    // Folder_Browser melihat sub-direktori di sandbox (Requirement 10.2)
    const fsRes = await fetch(`${baseUrl()}/api/fs?path=`);
    expect(fsRes.status).toBe(200);
    const fsBody = (await fsRes.json()) as { entries: string[] };
    expect(fsBody.entries).toContain("proj");

    // ---- buat Session (Requirement 1.1) ----
    const sessRes = await fetch(`${baseUrl()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentType: "opencode", projectId: projBody.project.id }),
    });
    expect(sessRes.status).toBe(201);
    const sessBody = (await sessRes.json()) as { session: Session };
    const sessionId = sessBody.session.id;
    expect(sessBody.session.status).toBe("running");

    const handle = handles.get(sessionId);
    expect(handle).toBeDefined();
    if (!handle) return;

    // ---- attach via WebSocket (Requirement 4.1) ----
    const msgs: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`);
    ws.onmessage = (event) => {
      msgs.push(JSON.parse(String(event.data)) as ServerMessage);
    };
    await waitFor(() => ws.readyState === WebSocket.OPEN, 3000, "koneksi WS terbuka");
    ws.send(JSON.stringify({ type: "attach", sessionId }));

    await waitFor(() => msgs.some((m) => m.type === "history"), 3000, "pesan history");
    expect(msgs.some((m) => m.type === "history")).toBe(true);

    // ---- terima Output_Stream real-time (Requirement 5.1) ----
    handle.emitData("Hello dari agent");
    await waitFor(
      () => msgs.some((m) => m.type === "output" && m.data === "Hello dari agent"),
      3000,
      "pesan output",
    );
    const output = msgs.find((m) => m.type === "output" && m.data === "Hello dari agent");
    expect(output).toBeDefined();
    if (output?.type === "output") expect(output.seq).toBeGreaterThan(0);

    // ---- Interactive_Prompt terdeteksi (Requirement 6.1) ----
    handle.emitData("Allow this command? (y/n)");
    await waitFor(() => msgs.some((m) => m.type === "prompt"), 3000, "pesan prompt");
    const promptMsg = msgs.find((m): m is Extract<ServerMessage, { type: "prompt" }> => {
      return m.type === "prompt";
    });
    expect(promptMsg).toBeDefined();
    const promptId = promptMsg?.prompt.id ?? "";
    expect(promptMsg?.prompt.type).toBe("confirmation");
    expect(promptMsg?.prompt.status).toBe("pending");

    // ---- respon Interactive_Prompt (Requirement 6.3, 6.4) ----
    ws.send(JSON.stringify({ type: "prompt_response", sessionId, promptId, response: "approve" }));
    await waitFor(
      () => msgs.some((m) => m.type === "prompt_resolved" && m.promptId === promptId),
      3000,
      "pesan prompt_resolved",
    );
    expect(handle.writes).toContain("y\n");

    // ---- stopSession (Requirement 1.6) ----
    const delRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    expect(handle.kills).toContain("SIGTERM");

    handle.emitExit(0);
    await waitFor(
      () => msgs.some((m) => m.type === "session_status" && m.status === "stopped"),
      3000,
      "notifikasi session_status stopped",
    );

    // Status tersimpan: stopped (Requirement 1.6)
    const listRes = await fetch(`${baseUrl()}/api/sessions`);
    const listBody = (await listRes.json()) as { sessions: Session[] };
    const listed = listBody.sessions.find((s) => s.id === sessionId);
    expect(listed?.status).toBe("stopped");

    ws.close();
  });

  test("20.2: daftar Project/Session melalui API lengkap", async () => {
    const projRes = await fetch(`${baseUrl()}/api/projects`);
    expect(projRes.status).toBe(200);
    const projBody = (await projRes.json()) as { projects: Project[] };
    expect(projBody.projects.length).toBeGreaterThan(0);

    const sessRes = await fetch(`${baseUrl()}/api/sessions`);
    expect(sessRes.status).toBe(200);
  });

  test("body JSON tidak valid -> 400 INVALID_JSON", async () => {
    const projRes = await fetch(`${baseUrl()}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid json",
    });
    expect(projRes.status).toBe(400);
    expect(((await projRes.json()) as { error: string }).error).toBe("INVALID_JSON");

    const sessRes = await fetch(`${baseUrl()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "bukan-json",
    });
    expect(sessRes.status).toBe(400);
    expect(((await sessRes.json()) as { error: string }).error).toBe("INVALID_JSON");
  });

  test("6.2: deteksi prompt tidak ganda setelah resolusi (reset buffer)", async () => {
    const projDir = path.join(root, "proj2");
    mkdirSync(projDir, { recursive: true });
    const projRes = await fetch(`${baseUrl()}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "prompt-dedup", path: "proj2" }),
    });
    expect(projRes.status).toBe(201);
    const projBody = (await projRes.json()) as { project: Project };

    const sessRes = await fetch(`${baseUrl()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentType: "opencode", projectId: projBody.project.id }),
    });
    expect(sessRes.status).toBe(201);
    const sessBody = (await sessRes.json()) as { session: Session };
    const sessionId = sessBody.session.id;

    const handle = handles.get(sessionId);
    expect(handle).toBeDefined();
    if (!handle) return;

    const msgs: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`);
    ws.onmessage = (event) => {
      msgs.push(JSON.parse(String(event.data)) as ServerMessage);
    };
    await waitFor(() => ws.readyState === WebSocket.OPEN, 3000, "koneksi WS terbuka");
    ws.send(JSON.stringify({ type: "attach", sessionId }));
    await waitFor(() => msgs.some((m) => m.type === "history"), 3000, "pesan history");

    // Prompt pertama terdeteksi.
    handle.emitData("Allow this command? (y/n)");
    await waitFor(
      () => msgs.filter((m) => m.type === "prompt").length === 1,
      3000,
      "prompt pertama",
    );
    const first = msgs.find(
      (m): m is Extract<ServerMessage, { type: "prompt" }> => m.type === "prompt",
    );
    const promptId = first?.prompt.id ?? "";
    expect(promptId).not.toBe("");

    ws.send(JSON.stringify({ type: "prompt_response", sessionId, promptId, response: "approve" }));
    await waitFor(
      () => msgs.some((m) => m.type === "prompt_resolved" && m.promptId === promptId),
      3000,
      "prompt_resolved",
    );

    // Output berikutnya TANPA pola prompt tidak boleh memicu prompt baru
    // (buffer sudah direset setelah deteksi).
    handle.emitData("proceeding with build");
    await Bun.sleep(150);
    expect(msgs.filter((m) => m.type === "prompt")).toHaveLength(1);

    const delRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    ws.close();
  });
});

describe("createKcgServer — wiring otentikasi (Req 9.2, 9.3)", () => {
  let app: KcgServer;
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "kcg-auth-"));
    app = createKcgServer({
      config: { sandboxRoot: root, configPath: "test" },
      auth: { hostname: "127.0.0.1", authEnabled: true, authToken: "secret" },
      store: openSessionStore(":memory:"),
      port: 0,
      spawn: (_cmd, _cwd, sessionId) => makePtyMock(sessionId),
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("HTTP tanpa token -> 401; dengan token benar -> 200", async () => {
    const url = `http://127.0.0.1:${app.server.port}/api/projects`;

    const unauth = await fetch(url);
    expect(unauth.status).toBe(401);

    const ok = await fetch(url, { headers: { authorization: "Bearer secret" } });
    expect(ok.status).toBe(200);

    const wrong = await fetch(url, { headers: { authorization: "Bearer salah" } });
    expect(wrong.status).toBe(401);
  });

  test("upgrade WS tanpa token -> close code 4401", async () => {
    const code = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`);
      ws.onclose = (event) => resolve(event.code);
      ws.onerror = () => reject(new Error("ws error sebelum close"));
      setTimeout(() => reject(new Error("timeout menunggu close WS")), 3000);
    });
    expect(code).toBe(4401);
  });
});
