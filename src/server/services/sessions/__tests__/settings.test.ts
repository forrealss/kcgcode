/**
 * Unit test pilihan per Session (`sessions/settings.ts`): model, thinking
 * effort, agent (mode), dan permission mode — disimpan lalu diterapkan ke
 * agent sebelum tiap prompt (permission mode: SEGERA bila client siap).
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { makeFakeClient } from "../../../__tests__/fake-agent";
import { clientOf, createSession, flush, freshHarness, modeHarness, promptOf } from "./harness";

// ---------------------------------------------------------------------------
// Pemilihan model (sesuai pilihan model di opencode)
// ---------------------------------------------------------------------------

const MODEL = { providerID: "kcgcode", modelID: "kiro/claude-opus-5" };

test("createSession dengan model valid -> tersimpan di Session & tervalidasi", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.createSession({ agentType: "opencode", projectId: "p1", model: MODEL });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("createSession gagal");
    expect(res.session.model).toEqual(MODEL);
    const stored = h.store.getSession(res.session.id);
    expect(stored.ok && stored.data.model).toEqual(MODEL);
    // Validasi memakai daftar provider server.
    const client = h.fake.clients.get("p1");
    expect(client?.calls).toContain("model.list");
  } finally {
    h.close();
  }
});

test("createSession dengan model tidak dikenal -> MODEL_NOT_FOUND, tanpa sesi remote", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.createSession({
      agentType: "opencode",
      projectId: "p1",
      model: { providerID: "kcgcode", modelID: "model-tidak-ada" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("harusnya ditolak");
    expect(res.error).toBe("MODEL_NOT_FOUND");
    const client = h.fake.clients.get("p1");
    // createSession remote tidak boleh terpanggil.
    expect(client?.calls.filter((c) => c.startsWith("session.create"))).toHaveLength(0);
    expect(h.store.listSessions()).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("createSession tanpa model -> null (default opencode), listModels tak dipanggil", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toBeNull();
    const client = h.fake.clients.get("p1");
    expect(client?.calls).not.toContain("model.list");
    // promptAsync dikirim tanpa model.
    await h.sm.sendFreeTextInput(sid, "hai");
    await flush();
    expect(client?.promptModels).toEqual([null]);
  } finally {
    h.close();
  }
});

test("session.create: listModels gagal -> error diteruskan, tanpa sesi remote", async () => {
  const h = freshHarness();
  try {
    const client = h.fake.clients.get("p1") ?? makeFakeClient();
    client.listModelsResult = { ok: false, error: "OC_LIST_MODELS_FAILED(500)" };
    h.fake.clients.set("p1", client);
    const res = await h.sm.createSession({ agentType: "opencode", projectId: "p1", model: MODEL });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("harusnya gagal");
    expect(res.error).toContain("OC_LIST_MODELS_FAILED");
  } finally {
    h.close();
  }
});

test("promptAsync selalu membawa model Session yang tersimpan", async () => {
  const h = freshHarness();
  try {
    const sid = await h.sm
      .createSession({ agentType: "opencode", projectId: "p1", model: MODEL })
      .then((r) => (r.ok ? r.session.id : ""));
    expect(sid).not.toBe("");

    await h.sm.sendFreeTextInput(sid, "pesan pertama");
    await flush();
    await h.sm.sendFreeTextInput(sid, "pesan kedua");
    await flush();
    const client = h.fake.clients.get("p1");
    expect(client?.promptModels).toEqual([
      "kcgcode/kiro/claude-opus-5",
      "kcgcode/kiro/claude-opus-5",
    ]);
  } finally {
    h.close();
  }
});

test("setSessionModel: ganti model -> prompt berikutnya memakai model baru", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const baru = { providerID: "kcgcode", modelID: "mimo/mimo-v2.5" };
    const client = h.fake.clients.get("p1");
    if (client) {
      client.availableModels = [
        ...client.availableModels,
        { providerID: "kcgcode", providerName: "kcgcode", modelID: baru.modelID, name: "Mimo" },
      ];
    }

    const res = h.sm.setSessionModel(sid, baru);
    expect(res.ok).toBe(true);
    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toEqual(baru);
    // Status tidak berubah akibat penggantian model.
    expect(stored.ok && stored.data.status).toBe("running");

    await h.sm.sendFreeTextInput(sid, "setelah ganti model");
    await flush();
    expect(client?.promptModels).toEqual(["kcgcode/mimo/mimo-v2.5"]);
  } finally {
    h.close();
  }
});

test("setSessionModel(null) -> kembali default; session tak dikenal -> SESSION_NOT_FOUND", async () => {
  const h = freshHarness();
  try {
    const sid = await h.sm
      .createSession({ agentType: "opencode", projectId: "p1", model: MODEL })
      .then((r) => (r.ok ? r.session.id : ""));

    expect(h.sm.setSessionModel(sid, null).ok).toBe(true);
    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toBeNull();

    const missing = h.sm.setSessionModel("tidak-ada", MODEL);
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("effort: dibawa createSession & setSessionEffort, diterapkan bersama model tiap prompt", async () => {
  const h = freshHarness();
  try {
    const created = await h.sm.createSession({
      agentType: "opencode",
      projectId: "p1",
      model: MODEL,
      effort: "high",
    });
    if (!created.ok) throw new Error("createSession gagal");
    const sid = created.session.id;
    expect(created.session.effort).toBe("high");

    await h.sm.sendFreeTextInput(sid, "pertama");
    await flush();
    // Kembali ke default model; model tetap.
    expect(h.sm.setSessionEffort(sid, null).ok).toBe(true);
    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.effort).toBeNull();
    expect(stored.ok && stored.data.model).toEqual(MODEL);
    await h.sm.sendFreeTextInput(sid, "kedua");
    await flush();

    const client = h.fake.clients.get("p1");
    expect(client?.promptEfforts).toEqual(["high", null]);
    expect(client?.promptModels).toEqual([
      "kcgcode/kiro/claude-opus-5",
      "kcgcode/kiro/claude-opus-5",
    ]);
  } finally {
    h.close();
  }
});

test("effort tidak valid -> INVALID_EFFORT; session tak dikenal -> SESSION_NOT_FOUND", async () => {
  const h = freshHarness();
  try {
    const bad = await h.sm.createSession({ agentType: "opencode", projectId: "p1", effort: "-x" });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("harusnya ditolak");
    expect(bad.error).toBe("INVALID_EFFORT");
    expect(h.store.listSessions()).toHaveLength(0);

    const sid = await createSession(h);
    expect(h.sm.setSessionEffort(sid, "a b").error).toBe("INVALID_EFFORT");
    expect(h.sm.setSessionEffort("tidak-ada", "low").error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("model bertahan setelah stop + resume (riwayat & pilihan utuh)", async () => {
  const h = freshHarness();
  try {
    const sid = await h.sm
      .createSession({ agentType: "opencode", projectId: "p1", model: MODEL })
      .then((r) => (r.ok ? r.session.id : ""));
    expect(h.sm.stopSession(sid).ok).toBe(true);
    expect(await h.sm.resumeSession(sid)).toEqual({ ok: true });

    const stored = h.store.getSession(sid);
    expect(stored.ok && stored.data.model).toEqual(MODEL);
    await h.sm.sendFreeTextInput(sid, "lanjut");
    await flush();
    expect(h.fake.clients.get("p1")?.promptModels).toEqual(["kcgcode/kiro/claude-opus-5"]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Agent (mode) Session
// ---------------------------------------------------------------------------

test("createSession + sendFreeTextInput meneruskan agent tersimpan ke promptAsync", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h, "opencode");
    expect(h.sm.setSessionAgent(sid, "plan").ok).toBe(true);
    // Status Session tetap terbaca dan agent tersimpan.
    const cur = h.store.getSession(sid);
    expect(cur.ok && cur.data.agent).toBe("plan");

    const r = await h.sm.sendFreeTextInput(sid, "buatkan rencana");
    expect(r.ok).toBe(true);
    await flush();
    expect(clientOf(h).promptAgents).toEqual(["plan"]);

    // Kembali ke default -> tanpa field agent di prompt berikutnya.
    expect(h.sm.setSessionAgent(sid, null).ok).toBe(true);
    await h.sm.sendFreeTextInput(sid, "lanjut eksekusi");
    await flush();
    expect(clientOf(h).promptAgents).toEqual(["plan", null]);
  } finally {
    h.close();
  }
});

test("setSessionAgent: session tidak ada / nama kosong -> ditolak", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    expect(h.sm.setSessionAgent("unknown", "plan").error).toBe("SESSION_NOT_FOUND");
    expect(h.sm.setSessionAgent(sid, "   ").error).toBe("INVALID_AGENT");
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Permission mode (capability agent, mis. Claude Code)
// ---------------------------------------------------------------------------

test("createSession: permissionMode divalidasi terhadap capability agent", async () => {
  const { h } = modeHarness();
  try {
    const bad = await h.sm.createSession({
      agentType: "claude-code",
      projectId: "p1",
      permissionMode: "yolo",
    });
    expect(bad).toEqual({ ok: false, error: "INVALID_PERMISSION_MODE" });
    const ok = await h.sm.createSession({
      agentType: "claude-code",
      projectId: "p1",
      permissionMode: "plan",
    });
    expect(ok.ok && ok.session.permissionMode).toBe("plan");
    // opencode tidak punya permission mode.
    const oc = await h.sm.createSession({
      agentType: "opencode",
      projectId: "p1",
      permissionMode: "plan",
    });
    expect(oc).toEqual({ ok: false, error: "INVALID_PERMISSION_MODE" });
  } finally {
    h.close();
  }
});

test("setSessionPermissionMode: diterapkan SEGERA ke agent + disimpan + hook", async () => {
  const { h, client, changes } = modeHarness();
  try {
    const sid = await createSession(h, "claude-code");
    expect((await h.sm.setSessionPermissionMode(sid, "plan")).ok).toBe(true);
    expect(client().calls).toContain("session.permission_mode:ses_remote1:plan");
    const cur = h.store.getSession(sid);
    expect(cur.ok && cur.data.permissionMode).toBe("plan");
    expect(changes).toEqual([[sid, "plan"]]);

    expect(await h.sm.setSessionPermissionMode(sid, "yolo")).toEqual({
      ok: false,
      error: "INVALID_PERMISSION_MODE",
    });
    // Agent gagal menerapkan -> pilihan tersimpan TIDAK berubah.
    client().permissionModeResult = { ok: false, error: "AGENT_PERMISSION_MODE_FAILED: boom" };
    expect((await h.sm.setSessionPermissionMode(sid, "default")).error).toBe(
      "AGENT_PERMISSION_MODE_FAILED: boom",
    );
    const after = h.store.getSession(sid);
    expect(after.ok && after.data.permissionMode).toBe("plan");
  } finally {
    h.close();
  }
});

test("setSessionPermissionMode: agent tanpa permission mode -> ditolak", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    expect(await h.sm.setSessionPermissionMode(sid, "plan")).toEqual({
      ok: false,
      error: "AGENT_PERMISSION_MODE_UNSUPPORTED",
    });
  } finally {
    h.close();
  }
});

test("mode yang dilaporkan agent (mis. rencana disetujui) memperbarui Session", async () => {
  const { h, client, changes } = modeHarness();
  try {
    const sid = await createSession(h, "claude-code");
    client().emit({
      type: "agent.permission_mode.changed",
      data: { sessionID: "ses_remote1", mode: "acceptEdits" },
    });
    // Mode sama dilaporkan ulang -> tanpa hook ganda.
    client().emit({
      type: "agent.permission_mode.changed",
      data: { sessionID: "ses_remote1", mode: "acceptEdits" },
    });
    const cur = h.store.getSession(sid);
    expect(cur.ok && cur.data.permissionMode).toBe("acceptEdits");
    expect(changes).toEqual([[sid, "acceptEdits"]]);
  } finally {
    h.close();
  }
});

test("prompt: permission mode Session diterapkan sebelum dikirim (agent ber-capability saja)", async () => {
  const { h, client } = modeHarness();
  try {
    const res = await h.sm.createSession({
      agentType: "claude-code",
      projectId: "p1",
      permissionMode: "plan",
    });
    if (!res.ok) throw new Error(res.error);
    await h.sm.sendFreeTextInput(res.session.id, "rencanakan");
    await flush();
    expect(client().promptModes).toEqual(["plan"]);
  } finally {
    h.close();
  }
  const oc = freshHarness();
  try {
    const sid = await createSession(oc);
    await oc.sm.sendFreeTextInput(sid, "halo");
    await flush();
    // opencode: langkah permission mode dilewati sama sekali.
    expect(clientOf(oc).calls.some((c) => c.startsWith("session.permission_mode"))).toBe(false);
  } finally {
    oc.close();
  }
});

test("form rencana -> prompt kind=plan dengan isi rencana; jawaban lewat form.reply", async () => {
  const { h, client } = modeHarness();
  try {
    const sid = await createSession(h, "claude-code");
    client().emit({
      type: "form.created",
      data: {
        form: {
          id: "frm_plan",
          sessionID: "ses_remote1",
          title: "Ready to implement this plan?",
          metadata: { kind: "plan", plan: "## Rencana\n1. Ubah a.ts" },
          fields: [
            {
              key: "decision",
              type: "string",
              description: "Ready to implement this plan?",
              options: [
                { value: "acceptEdits", label: "Yes, and auto-accept edits" },
                { value: "plan", label: "No, keep planning" },
              ],
              custom: true,
            },
          ],
        },
      },
    });
    const p = promptOf(h);
    expect(p).toMatchObject({
      id: "frm_plan",
      kind: "plan",
      type: "menu",
      title: "Ready to implement this plan?",
      detail: "## Rencana\n1. Ubah a.ts",
    });
    // Tersimpan utuh (reattach menampilkan kartu yang sama).
    const stored = h.store.getPrompt("frm_plan");
    expect(stored.ok && stored.data.detail).toBe("## Rencana\n1. Ubah a.ts");

    expect(
      (await h.sm.resolvePrompt(sid, "frm_plan", { option: "Yes, and auto-accept edits" })).ok,
    ).toBe(true);
    expect(client().calls).toContain("form.reply:frm_plan:acceptEdits");
  } finally {
    h.close();
  }
});
