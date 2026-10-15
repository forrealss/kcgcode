/**
 * Integration test end-to-end alur utama Session (task 20.2):
 * buat Project (POST /api/projects) -> buat Session (POST /api/sessions)
 * -> `attach` via WebSocket -> kirim `input` -> terima pesan terstruktur
 * -> event `permission.asked` -> respon prompt -> `stop`; plus lampiran
 * gambar, prompt gagal, dan pemilihan backend per tipe agent.
 *
 * Server nyata (`Bun.serve` via `createKcgServer`) + WebSocket client nyata;
 * hanya agent yang di-mock (`e2e-harness.ts`). Seluruh test berbagi satu
 * server & store — sebagian memakai Project yang dibuat test sebelumnya.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Project, Session } from "../../types";
import type { ServerMessage } from "../../ws-protocol";
import type { KcgServer } from "../app";
import { type E2EServer, e2eClient, startE2EServer, stopE2EServer, waitFor } from "./e2e-harness";
import type { FakeBackend } from "./fake-agent";

describe("createKcgServer — alur utama e2e (headless)", () => {
  let e2e: E2EServer;
  let app: KcgServer;
  let root: string;
  let opencode: FakeBackend;

  beforeAll(() => {
    e2e = startE2EServer();
    ({ app, root, opencode } = e2e);
  });

  afterAll(() => stopE2EServer(e2e));

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

    const client = e2eClient(opencode, projBody.project.id);
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
      data: {
        id: "per_1",
        sessionID: `ses_${projBody.project.id}`,
        action: "bash",
        resources: ["ls"],
      },
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
    expect(client.calls).toContain("permission.reply:per_1:once");

    // ---- stopSession (Requirement 1.6) — POST /stop, data tetap ada ----
    const stopRes = await fetch(`${baseUrl()}/api/sessions/${sessionId}/stop`, { method: "POST" });
    expect(stopRes.status).toBe(200);
    expect(client.calls).toContain(`session.interrupt:ses_${projBody.project.id}`);
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
    expect(client.calls).toContain(`session.remove:ses_${projBody.project.id}`);
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

    // Agent palsu menerima ref file image pada prompt.
    const client = e2eClient(opencode, projBody.project.id);
    expect(client?.promptFilesCalls.at(-1)).toContainEqual(
      expect.objectContaining({ mime: "image/png", name: "foto.png" }),
    );
    ws.close();
  });

  test("prompt gagal (session.execution.failed) -> error ke client + pesan error di history", async () => {
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
    const client = e2eClient(opencode, projBody.project.id);
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

  test("agentType claude-code memakai backend Claude Code; tipe tak dikenal ditolak", async () => {
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
      body: JSON.stringify({ agentType: "codex", projectId: body2.project.id }),
    });
    expect(sessRes.status).toBe(400);
    expect(((await sessRes.json()) as { error: string }).error).toBe("UNSUPPORTED_AGENT_TYPE");

    const claudeRes = await fetch(`${baseUrl()}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentType: "claude-code", projectId: body2.project.id }),
    });
    expect(claudeRes.status).toBe(201);
    const { session } = (await claudeRes.json()) as { session: Session };
    expect(session.agentType).toBe("claude-code");
    expect(session.ocSessionId).toBe(`ses_${body2.project.id}`);
  });
});
