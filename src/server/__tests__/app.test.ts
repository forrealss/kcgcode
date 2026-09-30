/**
 * Integration test end-to-end alur utama (task 20.2) + wiring otentikasi.
 *
 * Skenario dengan `OpenCodeServerManager` + `OpenCodeClient` mock:
 * buat Project (POST /api/projects) -> buat Session (POST /api/sessions)
 * -> `attach` via WebSocket -> kirim `input` -> terima pesan terstruktur
 * -> event `permission.asked` -> respon prompt -> `stop`.
 *
 * Server nyata (`Bun.serve` via `createKcgServer`) + WebSocket client nyata;
 * hanya komponen opencode headless yang di-mock.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore, type SessionStore } from "../../db";
import type { Project, Session } from "../../types";
import type { ServerMessage } from "../../ws-protocol";
import { createKcgServer, type KcgServer } from "../app";
import type { OpenCodeClient, OpenCodeEvent } from "../services/opencode-client";
import type { OpenCodeServerManager } from "../services/opencode-server";
import type { SkillsRegistry } from "../services/skills-registry";

// ---------------------------------------------------------------------------
// Mock OpenCodeClient + OpenCodeServerManager
// ---------------------------------------------------------------------------

interface FakeClient extends OpenCodeClient {
  emit(ev: OpenCodeEvent): void;
  sendMessageCalls: string[];
  replyPermissionCalls: [string, string][];
  abortCalls: string[];
  deleteCalls: string[];
  /** Referensi file yang dikirim ke tiap promptAsync. */
  promptFilesCalls: { filename: string; mime: string; url: string }[][];
  /** Apakah `getSession` melaporkan session remote masih ada (default: ya). */
  getSessionOk: boolean;
  /**
   * Prompt berikutnya gagal diproses opencode: alih-alih sukses, server
   * memancarkan `session.error` (meniru kegagalan diam-diam di sisi model).
   */
  failNextPrompt: boolean;
}

function makeFakeClient(projectId: string): FakeClient {
  let eventCb: ((ev: OpenCodeEvent) => void) | null = null;
  const client: FakeClient = {
    sendMessageCalls: [],
    replyPermissionCalls: [],
    abortCalls: [],
    deleteCalls: [],
    promptFilesCalls: [],
    getSessionOk: true,
    failNextPrompt: false,
    async createSession() {
      return { ok: true, data: { id: `ses_${projectId}`, directory: "/proj" } };
    },
    async getSession(_sessionId) {
      return client.getSessionOk ? { ok: true } : { ok: false, error: "OC_SESSION_NOT_FOUND" };
    },
    async deleteSession(sessionId) {
      client.deleteCalls.push(sessionId);
      return { ok: true };
    },
    async findFiles(query) {
      return { ok: true, data: query ? ["src/App.tsx"] : [] };
    },
    async listModels() {
      return {
        ok: true,
        data: [
          {
            providerID: "kcgcode",
            providerName: "kcgcode",
            modelID: "kiro/claude-opus-5",
            name: "Claude Opus 5",
          },
        ],
      };
    },
    async listAgents() {
      return {
        ok: true,
        data: [
          { name: "build", mode: "primary" as const, description: "Full tool access" },
          { name: "plan", mode: "primary" as const, description: "Planning only" },
        ],
      };
    },
    async listMcp() {
      return { ok: true, data: [{ name: "context7", status: "connected" as const, error: null }] };
    },
    async disposeInstance() {
      return { ok: true };
    },
    async listSkills() {
      return {
        ok: true,
        data: [
          {
            name: "shadcn",
            description: "UI kit",
            location: "/x/SKILL.md",
            source: "project" as const,
          },
        ],
      };
    },
    async sendMessage(_sessionId, text) {
      client.sendMessageCalls.push(text);
      return {
        ok: true,
        data: {
          info: { id: `msg_${projectId}`, role: "assistant" },
          parts: [{ type: "text", text: `balasan: ${text}` }],
        },
      };
    },
    /**
     * Meniru server sungguhan: prompt diterima (204), balasan mengalir lewat
     * SSE, lalu `session.idle` menutup turn. Bila `failNextPrompt`, prompt
     * justru gagal diproses — server memancarkan `session.error`.
     */
    async promptAsync(sessionId, text, _model, files) {
      client.sendMessageCalls.push(text);
      client.promptFilesCalls.push(files ?? []);
      if (client.failNextPrompt) {
        client.failNextPrompt = false;
        queueMicrotask(() => {
          client.emit({
            type: "session.error",
            sessionID: sessionId,
            error: {
              name: "UnknownError",
              data: {
                message:
                  'TypeError: File URL host must be "localhost" or empty on linux\n    at SessionPrompt.resolveUserPart',
              },
            },
          });
          // Error turn KCG Code bersifat "ditunda" — pesan error baru ditulis
          // saat turn ditutup tanpa konten baru (TurnStream.finish -> idle).
          // Tanpa idle, banner terkirim tapi history tetap kosong dan test menunggu 3 detik sia-sia.
          client.emit({ type: "session.idle", sessionID: sessionId });
        });
        return { ok: true, data: null };
      }
      const messageID = `msg_${projectId}`;
      queueMicrotask(() => {
        client.emit({
          type: "message.updated",
          sessionID: sessionId,
          info: { id: messageID, role: "assistant" },
        });
        client.emit({
          type: "message.part.updated",
          sessionID: sessionId,
          part: { type: "text", id: "prt_1", text: `balasan: ${text}`, messageID },
        });
        client.emit({ type: "session.idle", sessionID: sessionId });
      });
      return { ok: true, data: null };
    },
    async replyPermission(requestId, reply) {
      client.replyPermissionCalls.push([requestId, reply]);
      return { ok: true, data: null };
    },
    async replyQuestion() {
      return { ok: true, data: null };
    },
    async rejectQuestion() {
      return { ok: true, data: null };
    },
    async abortSession(sessionId) {
      client.abortCalls.push(sessionId);
      return { ok: true, data: null };
    },
    subscribeEvents(cb) {
      eventCb = cb;
      return () => {
        eventCb = null;
      };
    },
    async health() {
      return true;
    },
    emit(ev: OpenCodeEvent) {
      eventCb?.(ev);
    },
  };
  return client;
}

interface FakeServers {
  manager: OpenCodeServerManager;
  clients: Map<string, FakeClient>;
  stopped: string[];
}

function makeFakeServers(): FakeServers {
  const clients = new Map<string, FakeClient>();
  const stopped: string[] = [];
  return {
    stopped,
    clients,
    manager: {
      async ensureServer(projectId, _projectPath) {
        let client = clients.get(projectId);
        if (!client) {
          client = makeFakeClient(projectId);
          clients.set(projectId, client);
        }
        return { ok: true, data: { projectId, baseUrl: "http://x", client } };
      },
      async ensureFreshServer(projectId, projectPath) {
        return this.ensureServer(projectId, projectPath);
      },
      getServer(projectId) {
        const client = clients.get(projectId);
        return client ? { projectId, baseUrl: "http://x", client } : undefined;
      },
      async stopServer(projectId) {
        stopped.push(projectId);
        clients.delete(projectId);
      },
      async stopAll() {
        for (const id of [...clients.keys()]) stopped.push(id);
        clients.clear();
      },
      onServerExit() {},
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

describe("createKcgServer — alur utama e2e (headless)", () => {
  let store: SessionStore;
  let app: KcgServer;
  let root: string;
  let servers: FakeServers;
  /** Instalasi yang diminta ke Skills_Registry palsu: [cwd, source, skill]. */
  const installCalls: [string, string, string][] = [];
  const skillsRegistry: SkillsRegistry = {
    async search(q) {
      if (q.trim().length < 2) return { ok: false, error: "INVALID_SKILL_QUERY" };
      return {
        ok: true,
        data: [
          {
            id: "a/b/c",
            name: "c",
            source: "a/b",
            skillId: "c",
            installs: 3,
            url: "https://skills.sh/a/b/c",
          },
        ],
      };
    },
    async audit(source) {
      if (source === "bad") return { ok: false, error: "INVALID_SKILL_ID" };
      return { ok: true, data: { audits: null, overall: null } };
    },
    async install(cwd, source, skill, onLine) {
      installCalls.push([cwd, source, skill]);
      onLine?.(`installing ${skill}`);
      if (skill === "boom") return { ok: false, error: "SKILL_INSTALL_FAILED" };
      return { ok: true, data: { name: skill, path: `${cwd}/.agents/skills/${skill}` } };
    },
  };

  beforeAll(() => {
    store = openSessionStore(":memory:");
    root = mkdtempSync(path.join(tmpdir(), "kcg-e2e2-"));
    mkdirSync(path.join(root, "proj"), { recursive: true });
    servers = makeFakeServers();
    app = createKcgServer({
      config: { sandboxRoot: root, configPath: "test" },
      store,
      servers: servers.manager,
      uploadsRoot: path.join(root, "uploads"),
      port: 0,
      skillsRegistry,
    });
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  function baseUrl(): string {
    return `http://127.0.0.1:${app.server.port}`;
  }

  test("20.2: project -> session -> attach -> input -> pesan terstruktur -> prompt -> stop", async () => {
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
    expect(sessBody.session.ocSessionId).toBe(`ses_${projBody.project.id}`);

    const client = servers.clients.get(projBody.project.id);
    expect(client).toBeDefined();
    if (!client) return;

    // ---- attach via WebSocket (Requirement 4.1) ----
    const msgs: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`);
    ws.onmessage = (event) => {
      msgs.push(JSON.parse(String(event.data)) as ServerMessage);
    };
    await waitFor(() => ws.readyState === WebSocket.OPEN, 3000, "koneksi WS terbuka");
    ws.send(JSON.stringify({ type: "attach", sessionId }));

    await waitFor(() => msgs.some((m) => m.type === "history"), 3000, "pesan history");
    const hist = msgs.find((m): m is Extract<ServerMessage, { type: "history" }> => {
      return m.type === "history";
    });
    expect(hist?.messages ?? []).toHaveLength(0);

    // ---- kirim input -> echo user + balasan assistant (Requirement 7.1) ----
    ws.send(JSON.stringify({ type: "input", sessionId, text: "hello" }));
    await waitFor(
      () => msgs.filter((m) => m.type === "message" && m.message.role === "user").length === 1,
      3000,
      "echo pesan user",
    );
    await waitFor(
      () => msgs.filter((m) => m.type === "message" && m.message.role === "assistant").length === 1,
      3000,
      "balasan assistant",
    );
    const reply = msgs.find(
      (m): m is Extract<ServerMessage, { type: "message" }> =>
        m.type === "message" && m.message.role === "assistant",
    );
    // Parts dirakit dari SSE, jadi membawa metadata part (id, messageID).
    expect(reply?.message.parts).toHaveLength(1);
    expect(reply?.message.parts[0]).toMatchObject({ type: "text", text: "balasan: hello" });

    // ---- Interactive_Prompt dari event SSE terstruktur (Requirement 6) ----
    client.emit({
      type: "permission.asked",
      requestID: "per_1",
      sessionID: `ses_${projBody.project.id}`,
      permission: "bash:ls",
    });
    await waitFor(() => msgs.some((m) => m.type === "prompt"), 3000, "pesan prompt");
    const promptMsg = msgs.find((m): m is Extract<ServerMessage, { type: "prompt" }> => {
      return m.type === "prompt";
    });
    expect(promptMsg?.prompt.kind).toBe("permission");
    expect(promptMsg?.prompt.type).toBe("confirmation");

    // ---- respon prompt -> replyPermission (Requirement 6.3) ----
    ws.send(
      JSON.stringify({
        type: "prompt_response",
        sessionId,
        promptId: promptMsg?.prompt.id ?? "",
        response: "approve",
      }),
    );
    await waitFor(() => msgs.some((m) => m.type === "prompt_resolved"), 3000, "prompt_resolved");
    expect(client.replyPermissionCalls).toContainEqual(["per_1", "once"]);

    // ---- stopSession (Requirement 1.6) — POST /stop, data tetap ada ----
    const stopRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}/stop`, { method: "POST" });
    expect(stopRes.status).toBe(200);
    expect(client.abortCalls).toContain(`ses_${projBody.project.id}`);
    await waitFor(
      () => msgs.some((m) => m.type === "session_status" && m.status === "stopped"),
      3000,
      "session_status stopped",
    );

    const listRes = await fetch(`${baseUrl()}/api/sessions`);
    const listBody = (await listRes.json()) as { sessions: Session[] };
    const listed = listBody.sessions.find((s) => s.id === sessionId);
    expect(listed?.status).toBe("stopped");

    // ---- resume session stopped (ocSessionId dipertahankan) ----
    const resumeRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}`, { method: "POST" });
    expect(resumeRes.status).toBe(200);
    const resumeBody = (await resumeRes.json()) as { session: Session; ok: boolean };
    expect(resumeBody.ok).toBe(true);
    expect(resumeBody.session.status).toBe("running");
    // ocSessionId lama masih dikenal fake server -> tidak diganti.
    expect(resumeBody.session.ocSessionId).toBe(`ses_${projBody.project.id}`);
    // Input kembali berfungsi setelah resume (via WebSocket).
    ws.send(JSON.stringify({ type: "input", sessionId, text: "setelah resume" }));
    await waitFor(
      () => msgs.filter((m) => m.type === "message" && m.message.role === "user").length === 2,
      3000,
      "echo user setelah resume",
    );

    // Resume kedua kali -> konflik 409.
    const resumeRes2 = await fetch(`${baseUrl()}/api/sessions/${sessionId}`, { method: "POST" });
    expect(resumeRes2.status).toBe(409);

    // ---- deleteSession: hapus permanen (remote + lokal) ----
    const delRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    expect(client.deleteCalls).toContain(`ses_${projBody.project.id}`);
    // Session hilang dari daftar.
    const afterDel = (await (await fetch(`${baseUrl()}/api/sessions`)).json()) as {
      sessions: Session[];
    };
    expect(afterDel.sessions.find((s) => s.id === sessionId)).toBeUndefined();
    // Session sudah tidak ada -> hapus lagi -> 404.
    const delRes2 = await fetch(`${baseUrl()}/api/sessions/${sessionId}`, { method: "DELETE" });
    expect(delRes2.status).toBe(404);

    ws.close();
  });

  test("gambar: upload -> GET serve bytes -> kirim input dgn image -> part file image", async () => {
    // Path unik agar tidak bertabrakan dengan test lain (store dipakai bersama).
    mkdirSync(path.join(root, "proj-gambar"), { recursive: true });
    const projRes = await fetch(`${baseUrl()}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "gambar-proj", path: "proj-gambar" }),
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

    // PNG 1x1 minimal (header). Server tidak memvalidasi isi, hanya mime.
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], {
      type: "image/png",
    });
    const form = new FormData();
    form.append("file", png, "foto.png");
    const upRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}/uploads`, {
      method: "POST",
      body: form,
    });
    expect(upRes.status).toBe(201);
    const upBody = (await upRes.json()) as {
      upload: { id: string; filename: string; mime: string };
    };
    expect(upBody.upload.filename).toBe("foto.png");
    expect(upBody.upload.mime).toBe("image/png");
    const uploadId = upBody.upload.id;

    // GET mengembalikan bytes dengan content-type gambar.
    const getRes = await fetch(`${baseUrl()}/api/uploads/${sessionId}/${uploadId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toContain("image/png");

    // File non-gambar diterima, tapi disajikan sebagai unduhan (bukan inline)
    // agar HTML/SVG upload tidak bisa dieksekusi di origin aplikasi.
    const htmlForm = new FormData();
    htmlForm.append("file", new Blob(["<script>x</script>"], { type: "text/html" }), "a.html");
    const htmlRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}/uploads`, {
      method: "POST",
      body: htmlForm,
    });
    expect(htmlRes.status).toBe(201);
    const htmlId = ((await htmlRes.json()) as { upload: { id: string } }).upload.id;
    const htmlGet = await fetch(`${baseUrl()}/api/uploads/${sessionId}/${htmlId}`);
    expect(htmlGet.headers.get("content-type")).toBe("application/octet-stream");
    expect(htmlGet.headers.get("content-disposition")).toStartWith("attachment");
    expect(htmlGet.headers.get("x-content-type-options")).toBe("nosniff");

    // Kirim pesan dengan lampiran -> echo user memuat part file image;
    // promptAsync menerima ref gambar (mime image + url file).
    const msgs: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`);
    ws.onmessage = (event) => {
      msgs.push(JSON.parse(String(event.data)) as ServerMessage);
    };
    await waitFor(() => ws.readyState === WebSocket.OPEN, 3000, "koneksi WS terbuka");
    ws.send(JSON.stringify({ type: "attach", sessionId }));
    await waitFor(() => msgs.some((m) => m.type === "history"), 3000, "pesan history");
    ws.send(
      JSON.stringify({
        type: "input",
        sessionId,
        text: "jelaskan gambar ini",
        images: [uploadId],
      }),
    );
    await waitFor(
      () => msgs.filter((m) => m.type === "message" && m.message.role === "user").length === 1,
      3000,
      "echo pesan user dgn gambar",
    );
    const userMsg = msgs.find(
      (m): m is Extract<ServerMessage, { type: "message" }> =>
        m.type === "message" && m.message.role === "user",
    );
    const imagePart = userMsg?.message.parts.find(
      (p) => p.type === "file" && p.attachmentId === uploadId,
    );
    expect(imagePart?.mime).toBe("image/png");
    expect(imagePart?.filename).toBe("foto.png");
    expect(typeof imagePart?.url).toBe("string");

    // Fake server menerima ref file image pada promptAsync.
    const client = servers.clients.get(projBody.project.id);
    expect(client?.promptFilesCalls.at(-1)).toContainEqual(
      expect.objectContaining({ mime: "image/png", filename: "foto.png" }),
    );
    ws.close();
  });

  test("prompt gagal (session.error) -> error ke client + pesan error di history", async () => {
    // Path unik agar tidak bertabrakan dengan test lain (store dipakai bersama).
    mkdirSync(path.join(root, "proj-gagal"), { recursive: true });
    const projRes = await fetch(`${baseUrl()}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "gagal-proj", path: "proj-gagal" }),
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
    const client = servers.clients.get(projBody.project.id);
    if (!client) throw new Error("client p1 tidak ada");
    client.failNextPrompt = true;

    const msgs: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`);
    ws.onmessage = (event) => {
      msgs.push(JSON.parse(String(event.data)) as ServerMessage);
    };
    await waitFor(() => ws.readyState === WebSocket.OPEN, 3000, "koneksi WS terbuka");
    ws.send(JSON.stringify({ type: "attach", sessionId }));
    await waitFor(() => msgs.some((m) => m.type === "history"), 3000, "pesan history");

    ws.send(JSON.stringify({ type: "input", sessionId, text: "jelaskan" }));
    await waitFor(
      () => msgs.filter((m) => m.type === "message" && m.message.role === "user").length === 1,
      3000,
      "echo pesan user",
    );

    // Client menerima notifikasi error (banner) dengan pesan ramah.
    await waitFor(
      () => msgs.some((m) => m.type === "error" && m.code === "AGENT_ERROR"),
      3000,
      "pesan error AGENT_ERROR",
    );
    const err = msgs.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err?.message).toBe('TypeError: File URL host must be "localhost" or empty on linux');

    // Kegagalan bertahan di history: pesan assistant part `type: "error"`.
    await waitFor(
      () =>
        msgs.some(
          (m) =>
            m.type === "message" &&
            m.message.role === "assistant" &&
            m.message.parts.some((p) => p.type === "error"),
        ),
      3000,
      "pesan error di history",
    );
    const errMsg = msgs.find(
      (m): m is Extract<ServerMessage, { type: "message" }> =>
        m.type === "message" && m.message.role === "assistant",
    );
    expect(
      errMsg?.message.parts.some((p) => p.type === "error" && typeof p.text === "string"),
    ).toBe(true);
    ws.close();

    // Reattach: kegagalan tetap terlihat setelah reload (bukan hanya banner).
    const msgs2: ServerMessage[] = [];
    const ws2 = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`);
    ws2.onmessage = (event) => {
      msgs2.push(JSON.parse(String(event.data)) as ServerMessage);
    };
    await waitFor(() => ws2.readyState === WebSocket.OPEN, 3000, "koneksi WS kedua terbuka");
    ws2.send(JSON.stringify({ type: "attach", sessionId }));
    await waitFor(() => msgs2.some((m) => m.type === "history"), 3000, "history reattach");
    const hist = msgs2.find((m): m is Extract<ServerMessage, { type: "history" }> => {
      return m.type === "history";
    });
    expect(
      hist?.messages.some((m) => m.role === "assistant" && m.parts.some((p) => p.type === "error")),
    ).toBe(true);
    ws2.close();
  });

  test("20.2: daftar Project/Session melalui API lengkap", async () => {
    const projRes = await fetch(`${baseUrl()}/api/projects`);
    expect(projRes.status).toBe(200);
    const projBody = (await projRes.json()) as { projects: Project[] };
    expect(projBody.projects.length).toBeGreaterThan(0);

    const sessRes = await fetch(`${baseUrl()}/api/sessions`);
    expect(sessRes.status).toBe(200);
  });

  test("agentType claude-code ditolak (v1 headless hanya opencode)", async () => {
    const projRes = await fetch(`${baseUrl()}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo2", path: "proj" }),
    });
    expect(projRes.status).toBe(409); // path sudah dipakai
    // Buat path baru untuk project lain.
    mkdirSync(path.join(root, "proj2"), { recursive: true });
    const proj2 = await fetch(`${baseUrl()}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo2b", path: "proj2" }),
    });
    expect(proj2.status).toBe(201);
    const body2 = (await proj2.json()) as { project: Project };

    const sessRes = await fetch(`${baseUrl()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentType: "claude-code", projectId: body2.project.id }),
    });
    expect(sessRes.status).toBe(400);
    expect(((await sessRes.json()) as { error: string }).error).toBe("UNSUPPORTED_AGENT_TYPE");
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

  test("GET /api/projects/:id/mcp & /skills -> daftar dari server Project; id tak dikenal -> 404", async () => {
    mkdirSync(path.join(root, "proj-ext"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ext-proj", path: "proj-ext" }),
      })
    ).json()) as { project: Project };

    const mcpRes = await fetch(`${baseUrl()}/api/projects/${proj.project.id}/mcp`);
    expect(mcpRes.status).toBe(200);
    expect(((await mcpRes.json()) as { mcp: { name: string }[] }).mcp[0]?.name).toBe("context7");

    const skillsRes = await fetch(`${baseUrl()}/api/projects/${proj.project.id}/skills`);
    expect(skillsRes.status).toBe(200);
    expect(((await skillsRes.json()) as { skills: { source: string }[] }).skills[0]?.source).toBe(
      "project",
    );

    expect((await fetch(`${baseUrl()}/api/projects/tidak-ada/mcp`)).status).toBe(404);
    expect((await fetch(`${baseUrl()}/api/projects/tidak-ada/skills`)).status).toBe(404);
  });

  test("model: GET /api/projects/:id/models + create dengan model + PUT ganti model", async () => {
    mkdirSync(path.join(root, "proj-model"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "model-proj", path: "proj-model" }),
      })
    ).json()) as { project: Project };

    // ---- daftar model tersedia ----
    const modelsRes = await fetch(`${baseUrl()}/api/projects/${proj.project.id}/models`);
    expect(modelsRes.status).toBe(200);
    const modelsBody = (await modelsRes.json()) as {
      models: { providerID: string; modelID: string; name: string }[];
    };
    expect(modelsBody.models[0]).toMatchObject({
      providerID: "kcgcode",
      modelID: "kiro/claude-opus-5",
    });

    // ---- create Session dengan model pilihan ----
    const sess = (await (
      await fetch(`${baseUrl()}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentType: "opencode",
          projectId: proj.project.id,
          model: { providerID: "kcgcode", modelID: "kiro/claude-opus-5" },
        }),
      })
    ).json()) as { session: Session };
    expect(sess.session.model).toEqual({
      providerID: "kcgcode",
      modelID: "kiro/claude-opus-5",
    });

    // ---- model tidak dikenal -> 400 MODEL_NOT_FOUND ----
    const badRes = await fetch(`${baseUrl()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentType: "opencode",
        projectId: proj.project.id,
        model: { providerID: "kcgcode", modelID: "tidak-ada" },
      }),
    });
    expect(badRes.status).toBe(400);
    expect(((await badRes.json()) as { error: string }).error).toBe("MODEL_NOT_FOUND");

    // ---- ganti model via PUT ----
    const putRes = await fetch(`${baseUrl()}/api/sessions/${sess.session.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: null }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { session: Session };
    expect(putBody.session.model).toBeNull();

    // Session tak dikenal -> 404
    const missing = await fetch(`${baseUrl()}/api/sessions/tidak-ada`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: null }),
    });
    expect(missing.status).toBe(404);
  });

  test("@file: GET /api/sessions/:id/files mencari via server headless", async () => {
    mkdirSync(path.join(root, "proj-files"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "files-proj", path: "proj-files" }),
      })
    ).json()) as { project: Project };

    const sess = (await (
      await fetch(`${baseUrl()}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentType: "opencode", projectId: proj.project.id }),
      })
    ).json()) as { session: Session };

    // Query mencocokkan file dari fake client (availableFiles).
    const found = await fetch(`${baseUrl()}/api/sessions/${sess.session.id}/files?q=App`);
    expect(found.status).toBe(200);
    const foundBody = (await found.json()) as { files: string[] };
    expect(foundBody.files).toContain("src/App.tsx");

    // Session tak dikenal -> 404.
    const missing = await fetch(`${baseUrl()}/api/sessions/tidak-ada/files?q=x`);
    expect(missing.status).toBe(404);
  });

  test("hapus Project: Session ikut dibersihkan, server headless dihentikan, direktori utuh", async () => {
    const dir = path.join(root, "proj-hapus");
    mkdirSync(dir, { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "hapus-proj", path: "proj-hapus" }),
      })
    ).json()) as { project: Project };

    const sess = (await (
      await fetch(`${baseUrl()}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentType: "opencode", projectId: proj.project.id }),
      })
    ).json()) as { session: Session };
    const client = servers.clients.get(proj.project.id);
    expect(client).toBeDefined();

    const del = await fetch(`${baseUrl()}/api/projects/${proj.project.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    // Session lokal + sesi remote opencode ikut terhapus.
    expect(store.getSession(sess.session.id).ok).toBe(false);
    expect(client?.deleteCalls).toContain(sess.session.ocSessionId ?? "");
    // Server headless Project dihentikan (tidak lagi memakan memori).
    expect(servers.stopped).toContain(proj.project.id);
    // Project hilang dari daftar, tapi direktori kerjanya TIDAK dihapus.
    expect(store.listProjects().some((p) => p.id === proj.project.id)).toBe(false);
    expect(existsSync(dir)).toBe(true);
  });

  test("hapus Project tanpa Session -> 200; id tak dikenal -> 404", async () => {
    mkdirSync(path.join(root, "proj-kosong"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "kosong-proj", path: "proj-kosong" }),
      })
    ).json()) as { project: Project };

    const del = await fetch(`${baseUrl()}/api/projects/${proj.project.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const missing = await fetch(`${baseUrl()}/api/projects/tidak-ada`, { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("PROJECT_NOT_FOUND");
  });

  test("PATCH instructions Project: simpan, kosongkan, validasi, 404", async () => {
    mkdirSync(path.join(root, "proj-instr"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "instr-proj", path: "proj-instr" }),
      })
    ).json()) as { project: Project };
    expect(proj.project.instructions).toBeNull();

    const patch = (id: string, body: unknown) =>
      fetch(`${baseUrl()}/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const saved = await patch(proj.project.id, { instructions: "  Reply in English.  " });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { project: Project }).project.instructions).toBe(
      "Reply in English.",
    );

    // Tersimpan & ikut di GET daftar.
    const list = (await (await fetch(`${baseUrl()}/api/projects`)).json()) as {
      projects: Project[];
    };
    expect(list.projects.find((p) => p.id === proj.project.id)?.instructions).toBe(
      "Reply in English.",
    );

    const cleared = await patch(proj.project.id, { instructions: "   " });
    expect(((await cleared.json()) as { project: Project }).project.instructions).toBeNull();

    expect((await patch(proj.project.id, { instructions: 42 })).status).toBe(400);
    expect((await patch(proj.project.id, { instructions: "x".repeat(20_001) })).status).toBe(400);
    expect((await patch("tidak-ada", { instructions: "x" })).status).toBe(404);
  });

  test("skills.sh: search, audit, install ke folder Project (+ validasi & 404)", async () => {
    mkdirSync(path.join(root, "proj-skills"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "skills-proj", path: "proj-skills" }),
      })
    ).json()) as { project: Project };

    const search = await fetch(`${baseUrl()}/api/skills/search?q=react`);
    expect(search.status).toBe(200);
    expect(((await search.json()) as { skills: { id: string }[] }).skills[0]?.id).toBe("a/b/c");
    expect((await fetch(`${baseUrl()}/api/skills/search?q=a`)).status).toBe(400);

    const audit = await fetch(`${baseUrl()}/api/skills/audit?source=a/b&skill=c`);
    expect(audit.status).toBe(200);
    expect((await fetch(`${baseUrl()}/api/skills/audit?source=bad&skill=c`)).status).toBe(400);

    const install = (id: string, body: unknown) =>
      fetch(`${baseUrl()}/api/projects/${id}/skills/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // Instalasi berjalan sebagai job: 202 + job, lalu status & log via polling.
    const ok = await install(proj.project.id, { source: "a/b", skill: "c" });
    expect(ok.status).toBe(202);
    const { job } = (await ok.json()) as { job: { id: string; status: string } };
    expect(job.status).toBe("running");
    await app.skillInstalls.settled(job.id);

    const polled = await fetch(`${baseUrl()}/api/skills/installs/${job.id}?from=0`);
    expect(polled.status).toBe(200);
    const log = (await polled.json()) as {
      job: { status: string; refreshed: boolean };
      lines: string[];
    };
    expect(log.job.status).toBe("succeeded");
    // Server headless Project belum hidup -> tidak perlu refresh.
    expect(log.job.refreshed).toBe(true);
    expect(log.lines).toContain("installing c");
    expect(installCalls).toContainEqual([proj.project.path, "a/b", "c"]);

    const all = (await (await fetch(`${baseUrl()}/api/skills/installs`)).json()) as {
      jobs: { id: string }[];
    };
    expect(all.jobs.map((j) => j.id)).toContain(job.id);
    expect((await fetch(`${baseUrl()}/api/skills/installs/tidak-ada`)).status).toBe(404);

    // Kegagalan CLI -> job failed (bukan HTTP error).
    const boom = (await (
      await install(proj.project.id, { source: "a/b", skill: "boom" })
    ).json()) as { job: { id: string } };
    await app.skillInstalls.settled(boom.job.id);
    const boomLog = (await (
      await fetch(`${baseUrl()}/api/skills/installs/${boom.job.id}`)
    ).json()) as { job: { status: string; error: string } };
    expect(boomLog.job.status).toBe("failed");
    expect(boomLog.job.error).toBe("SKILL_INSTALL_FAILED");

    expect((await install(proj.project.id, { source: 1, skill: "c" })).status).toBe(400);
    expect((await install("tidak-ada", { source: "a/b", skill: "c" })).status).toBe(404);
  });
});
