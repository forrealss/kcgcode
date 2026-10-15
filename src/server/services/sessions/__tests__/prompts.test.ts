/**
 * Unit test Interactive_Prompt dari event agent: `permission.asked` ->
 * confirmation, `form.created` / `question.asked` -> menu question,
 * termasuk varian v2 dan deduplikasi kartu.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { clientOf, createSession, ev, freshHarness, promptOf, qField } from "./harness";

test("event permission.asked -> prompt kind=permission + onPrompt", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.permission("ses_remote1", "per_1", "bash:ls", ["ls"]));

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.kind).toBe("permission");
    expect(p.type).toBe("confirmation");
    expect(p.sessionId).toBe(sid);
    expect(p.id).toBe("per_1");
    expect(p.title).toContain("bash:ls");
    expect(p.status).toBe("pending");
  } finally {
    h.close();
  }
});

test("event question.asked -> prompt kind=question menu + options", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(
      ev.form("ses_remote1", "que_1", [
        qField(
          0,
          "Gunakan mode apa?",
          [
            { label: "Build", description: "menulis kode" },
            { label: "Plan", description: "hanya rencana" },
          ],
          { header: "mode" },
        ),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.kind).toBe("question");
    expect(p.type).toBe("menu");
    expect(p.sessionId).toBe(sid);
    expect(p.title).toBe("Gunakan mode apa?");
    // Opsi dinormalisasi ke PromptOption — description ikut tersimpan.
    expect(p.options).toEqual([
      { label: "Build", description: "menulis kode" },
      { label: "Plan", description: "hanya rencana" },
    ]);
    // Flag `custom` default true di skema question opencode.
    expect(p.custom).toBe(true);
  } finally {
    h.close();
  }
});

test("event question.asked custom=false -> prompt.custom false (tanpa input bebas)", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(
      ev.form("ses_remote1", "que_c0", [
        qField(0, "Pilih salah satu", [{ label: "A", description: "a" }], {
          header: "pilih",
          custom: false,
        }),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    expect(promptOf(h).custom).toBe(false);
    expect(promptOf(h).sessionId).toBe(sid);
  } finally {
    h.close();
  }
});

test("event permission.v2.asked (action/resources) -> prompt confirmation", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.permission("ses_remote1", "per_v2", "bash", ["echo hi"]));

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.id).toBe("per_v2");
    expect(p.kind).toBe("permission");
    expect(p.type).toBe("confirmation");
    expect(p.sessionId).toBe(sid);
    // Judul dirakit dari `action` + `resources` (penamaan v2).
    expect(p.title).toContain("bash");
    expect(p.title).toContain("echo hi");
  } finally {
    h.close();
  }
});

test("event question.v2.asked -> prompt menu + options", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(
      ev.form("ses_remote1", "que_v2", [
        qField(0, "Lanjut deploy?", ["Ya", "Tidak"], { header: "deploy" }),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.id).toBe("que_v2");
    expect(p.kind).toBe("question");
    expect(p.type).toBe("menu");
    expect(p.sessionId).toBe(sid);
    expect(p.title).toBe("Lanjut deploy?");
    expect(p.options).toEqual([
      { label: "Ya", description: null },
      { label: "Tidak", description: null },
    ]);
  } finally {
    h.close();
  }
});

test("v1 + v2 untuk request yang sama -> kartu tidak terduplikasi", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const client = clientOf(h);

    // Server memancarkan kedua varian untuk satu request (id sama).
    client.emit(ev.permission("ses_remote1", "per_sama", "bash", ["ls"]));
    client.emit(ev.permission("ses_remote1", "per_sama", "bash", ["ls"]));

    // `prompts.id` PRIMARY KEY menjadikan insert kedua gagal -> satu kartu.
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]?.id).toBe("per_sama");
  } finally {
    h.close();
  }
});

test("prompt v2 dapat diselesaikan lewat resolvePrompt seperti v1", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.permission("ses_remote1", "per_v2_resolve", "edit", ["src/a.ts"]));

    // Endpoint reply dipakai bersama v1/v2 (tidak ada rute v2 terpisah).
    const r = await h.sm.resolvePrompt(sid, "per_v2_resolve", "approve");
    expect(r.ok).toBe(true);
    expect(client.calls).toContain("permission.reply:per_v2_resolve:once");

    const stored = h.store.getPrompt("per_v2_resolve");
    expect(stored.ok && stored.data.status).toBe("resolved");
  } finally {
    h.close();
  }
});

test("event permission.asked dengan sessionID tak dikenal -> diabaikan", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    clientOf(h).emit(ev.permission("ses_tak_dikenal", "per_x", "bash"));
    expect(h.prompts).toHaveLength(0);
  } finally {
    h.close();
  }
});
