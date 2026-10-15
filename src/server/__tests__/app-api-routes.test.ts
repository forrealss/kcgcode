/**
 * Integration test rute `/api/*` lewat server nyata (`createKcgServer`):
 * validasi body JSON, MCP/skill/slash command Project, model & effort
 * Session, pencarian @file, panel konteks, hapus Project, instruksi Project,
 * dan instalasi skill dari skills.sh.
 *
 * Hanya agent & Skills_Registry yang di-mock (`e2e-harness.ts`); seluruh
 * test berbagi satu server & store.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SessionStore } from "../../db";
import type { Project, Session, SessionContext, SlashCommandInfo } from "../../types";
import type { KcgServer } from "../app";
import { type E2EServer, e2eClient, startE2EServer, stopE2EServer } from "./e2e-harness";
import type { FakeBackend } from "./fake-agent";

describe("createKcgServer — alur utama e2e (headless)", () => {
  let e2e: E2EServer;
  let store: SessionStore;
  let app: KcgServer;
  let root: string;
  let opencode: FakeBackend;
  let claude: FakeBackend;
  let installCalls: E2EServer["installCalls"];

  beforeAll(() => {
    e2e = startE2EServer();
    ({ store, app, root, opencode, claude, installCalls } = e2e);
  });

  afterAll(() => stopE2EServer(e2e));

  function baseUrl(): string {
    return `http://127.0.0.1:${app.server.port}`;
  }

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

    // ---- kendali MCP: balasan membawa daftar terbaru ----
    const post = (sub: string, body: unknown) =>
      fetch(`${baseUrl()}/api/projects/${proj.project.id}/${sub}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const off = await post("mcp/toggle", { name: "context7", enabled: false });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({
      ok: true,
      mcp: [{ name: "context7", status: "disabled", error: null }],
    });
    expect((await post("mcp/reconnect", { name: "context7" })).status).toBe(200);
    const bad = await post("mcp/toggle", { name: "context7" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("INVALID_MCP_SERVER");
    expect((await post("mcp/reconnect", {})).status).toBe(400);

    // ---- reload skill di agent ----
    const reload = await post("skills/reload", {});
    expect(reload.status).toBe(200);
    expect(await reload.json()).toEqual({ refreshed: true });

    // ---- slash command (autocomplete `/` composer) ----
    const cmdRes = await fetch(`${baseUrl()}/api/projects/${proj.project.id}/commands`);
    expect(cmdRes.status).toBe(200);
    expect(((await cmdRes.json()) as { commands: SlashCommandInfo[] }).commands).toEqual([
      { name: "review", description: "Review changes", argumentHint: "[pr#]" },
    ]);
    expect((await fetch(`${baseUrl()}/api/projects/tidak-ada/commands`)).status).toBe(404);
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

    // ---- thinking effort: diganti bersama model, null = default model ----
    const effortRes = await fetch(`${baseUrl()}/api/sessions/${sess.session.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ effort: "high" }),
    });
    expect(effortRes.status).toBe(200);
    expect(((await effortRes.json()) as { session: Session }).session.effort).toBe("high");
    const badEffort = await fetch(`${baseUrl()}/api/sessions/${sess.session.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ effort: "bukan effort" }),
    });
    expect(badEffort.status).toBe(400);
    expect(((await badEffort.json()) as { error: string }).error).toBe("INVALID_EFFORT");

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

  test("panel konteks: GET /api/sessions/:id/context memuat git, task list & perubahan file", async () => {
    mkdirSync(path.join(root, "proj-ctx"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ctx-proj", path: "proj-ctx" }),
      })
    ).json()) as { project: Project };

    const sess = (await (
      await fetch(`${baseUrl()}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentType: "opencode", projectId: proj.project.id }),
      })
    ).json()) as { session: Session };

    // Data tool berasal dari fake client Project ini (server headless-nya
    // sudah dibuat saat Session dibuat).
    const client = e2eClient(opencode, proj.project.id);
    if (!client) throw new Error("fake client tidak ada");
    client.todos = [
      { content: "Tulis tes", status: "in_progress", priority: "high" },
      { content: "Rapikan UI", status: "pending", priority: "medium" },
    ];
    client.fileChanges = [{ path: "src/App.tsx", added: 3, removed: 1, status: "modified" }];

    const res = await fetch(`${baseUrl()}/api/sessions/${sess.session.id}/context`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { context: SessionContext };
    expect(body.context.todos.map((t) => t.status)).toEqual(["in_progress", "pending"]);
    expect(body.context.changes[0]?.path).toBe("src/App.tsx");
    expect(body.context.changes[0]?.added).toBe(3);
    expect(body.context.live).toBe(true);
    // MCP server Project ikut dimuat (fake client: context7 connected).
    expect(body.context.mcp).toEqual([{ name: "context7", status: "connected", error: null }]);
    // Direktori project di tmpdir bukan repo git -> bagian git kosong, bukan error.
    expect(body.context.git.branch).toBeNull();
    expect(body.context.git.hasRemote).toBe(false);

    // Session tak dikenal -> 404.
    const missing = await fetch(`${baseUrl()}/api/sessions/tidak-ada/context`);
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
    const client = e2eClient(opencode, proj.project.id);
    expect(client).toBeDefined();

    const del = await fetch(`${baseUrl()}/api/projects/${proj.project.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    // Session lokal + sesi remote opencode ikut terhapus.
    expect(store.getSession(sess.session.id).ok).toBe(false);
    expect(client?.calls).toContain(`session.remove:${sess.session.ocSessionId ?? ""}`);
    // Server headless Project dihentikan (tidak lagi memakan memori).
    expect(opencode.released).toContain(proj.project.id);
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

  test("external-sessions: daftar Session Claude Desktop/CLI, 409 bila masih terbuka, impor salinan", async () => {
    mkdirSync(path.join(root, "proj-import"), { recursive: true });
    const proj = (await (
      await fetch(`${baseUrl()}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "import-proj", path: "proj-import" }),
      })
    ).json()) as { project: Project };
    const url = `${baseUrl()}/api/projects/${proj.project.id}/external-sessions`;

    // Client palsu belum punya `external` -> agent tidak mendukung impor.
    const unsupported = await fetch(url);
    expect(unsupported.status).toBe(400);
    expect(((await unsupported.json()) as { error: string }).error).toBe(
      "EXTERNAL_SESSIONS_UNSUPPORTED",
    );

    const client = e2eClient(claude, proj.project.id);
    if (!client) throw new Error("client claude belum dibuat");
    const desktop = { id: "cc-open", title: "From Desktop", updatedAt: 1, openElsewhere: true };
    client.external = {
      list: async () => ({ ok: true, data: [desktop] }),
      history: async () => ({
        ok: true,
        data: [{ id: "usr_1", role: "user", parts: [{ type: "text", text: "hi" }], createdAt: 1 }],
      }),
      fork: async (id) => ({ ok: true, data: { id: `${id}-copy` } }),
    };

    const listRes = await fetch(url);
    expect(listRes.status).toBe(200);
    expect(((await listRes.json()) as { sessions: unknown[] }).sessions).toEqual([desktop]);

    const post = (body: unknown) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const open = await post({ id: "cc-open" });
    expect(open.status).toBe(409);
    expect(((await open.json()) as { error: string }).error).toBe("EXTERNAL_SESSION_OPEN");
    expect((await post({})).status).toBe(404);

    const copy = await post({ id: "cc-open", fork: true });
    expect(copy.status).toBe(201);
    const { session } = (await copy.json()) as { session: Session };
    expect(session).toMatchObject({
      agentType: "claude-code",
      ocSessionId: "cc-open-copy",
      title: "From Desktop",
      status: "running",
    });
    const msgs = store.getMessages(session.id);
    expect(msgs.ok && msgs.data.map((m) => m.id)).toEqual(["usr_1"]);
  });
});
