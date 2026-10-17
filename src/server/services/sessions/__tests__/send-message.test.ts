/**
 * Unit test kirim input bebas (`sessions/send-message.ts`): validasi,
 * echo pesan user, instruksi Project, serta judul Session (sementara dari
 * prompt pertama, lalu judul dari agent).
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import {
  clientOf,
  createSession,
  emitAll,
  ev,
  flush,
  freshHarness,
  freshHarnessWithHooks,
  textPart,
} from "./harness";

// ---------------------------------------------------------------------------
// Free-text input
// ---------------------------------------------------------------------------

test("sendFreeTextInput: validasi text -> TEXT_EMPTY / TEXT_TOO_LONG / not found / inactive", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    expect((await h.sm.sendFreeTextInput(sid, "   ")).error).toBe("TEXT_EMPTY");
    expect((await h.sm.sendFreeTextInput(sid, "")).error).toBe("TEXT_EMPTY");
    expect((await h.sm.sendFreeTextInput(sid, "x".repeat(10001))).error).toBe("TEXT_TOO_LONG");
    expect((await h.sm.sendFreeTextInput("unknown", "halo")).error).toBe("SESSION_NOT_FOUND");

    // Session dihentikan -> tidak aktif.
    const r = await h.sm.stopSession(sid);
    expect(r.ok).toBe(true);
    expect((await h.sm.sendFreeTextInput(sid, "halo")).error).toBe("SESSION_NOT_ACTIVE");
  } finally {
    h.close();
  }
});

test("sendFreeTextInput sukses -> echo user; assistant dirakit saat eksekusi selesai", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const res = await h.sm.sendFreeTextInput(sid, "hello");
    expect(res.ok).toBe(true);

    // Echo user tersimpan & terkirim segera.
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]?.role).toBe("user");
    expect(h.messages[0]?.parts).toEqual([{ type: "text", text: "hello" }]);

    await flush();

    // Prompt dikirim tanpa menunggu balasan — belum ada pesan assistant.
    const client = clientOf(h);
    expect(client.calls).toContain("session.prompt:hello");
    expect(h.messages).toHaveLength(1);

    // Balasan tiba sebagai event step + teks.
    emitAll(client, [
      ev.step("ses_remote1", "msg_a1"),
      ...ev.text("ses_remote1", "msg_a1", "balasan: hello"),
    ]);
    // Turn belum ditutup sebelum eksekusi selesai.
    expect(h.messages).toHaveLength(1);

    // Eksekusi Session akar selesai menutup turn -> pesan assistant dirakit.
    client.emit(ev.idle("ses_remote1"));

    expect(h.messages).toHaveLength(2);
    expect(h.messages[1]?.role).toBe("assistant");
    expect(h.messages[1]?.id).toBe("msg_a1");
    expect(h.messages[1]?.parts).toEqual([textPart("msg_a1", "balasan: hello")]);

    // Keduanya tersimpan di store (round-trip history).
    const stored = h.store.getMessages(sid);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.data).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput: session.prompt gagal -> onError + pesan error tersimpan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.promptResult = { ok: false, error: "AGENT_PROMPT_FAILED: HTTP 500" };
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    // Pesan error ramah (bukan kode mentah) dan ditulis ke history (part error).
    expect(h.errors[0]?.[1]).toBe("Failed to send the prompt: HTTP 500");
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([{ type: "error", text: h.errors[0]?.[1] }]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput meneruskan custom instruction Project sebagai system", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h, "opencode");

    // Tanpa instruksi -> system null.
    await h.sm.sendFreeTextInput(sid, "halo");
    await flush();

    // Instruksi diubah setelah Session dibuat -> langsung berlaku.
    expect(
      h.store.updateProjectInstructions(h.project.id, "Selalu jawab dalam Bahasa Indonesia.").ok,
    ).toBe(true);
    await h.sm.sendFreeTextInput(sid, "lanjut");
    await flush();

    expect(clientOf(h).promptSystems).toEqual([null, "Selalu jawab dalam Bahasa Indonesia."]);
  } finally {
    h.close();
  }
});

test("extraInstructions kcgcode digabung setelah instruksi Project", async () => {
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      extraInstructions: (s) => (s.agentType === "opencode" ? "Dev server is managed." : null),
    },
  );
  try {
    const sid = await createSession(h, "opencode");
    await h.sm.sendFreeTextInput(sid, "halo");
    await flush();
    h.store.updateProjectInstructions(h.project.id, "Be brief.");
    await h.sm.sendFreeTextInput(sid, "lagi");
    await flush();
    expect(clientOf(h).promptSystems).toEqual([
      "Dev server is managed.",
      "Be brief.\n\nDev server is managed.",
    ]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Judul Session
// ---------------------------------------------------------------------------

test("session.updated -> judul akar disimpan + onTitleChange; judul sama diabaikan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    client.emit(ev.renamed("ses_remote1", "Refactor auth module"));
    const sess = h.store.getSession(sid);
    expect(sess.ok).toBe(true);
    if (sess.ok) expect(sess.data.title).toBe("Refactor auth module");
    expect(h.titles).toEqual([[sid, "Refactor auth module"]]);

    // Judul identik -> tanpa update DB, tanpa broadcast ulang.
    client.emit(ev.renamed("ses_remote1", "Refactor auth module"));
    expect(h.titles).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("createSession tidak mengirim judul -> opencode yang meng-generate judul", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const calls = clientOf(h).calls.filter((c) => c.startsWith("session.create:"));
    expect(calls).toEqual(["session.create:"]);
    const sess = h.store.listSessions()[0];
    expect(sess?.title).toBeNull();
  } finally {
    h.close();
  }
});

test("judul sementara dari prompt pertama, lalu diganti judul hasil opencode", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "tolong jelaskan cara kerja rate limiting di express");
    const temp = h.store.getSession(sid);
    expect(temp.ok && temp.data.title).toBe("tolong jelaskan cara kerja rate limiting di…");

    // Placeholder opencode (dikirim saat Session dibuat) tidak menimpa judul.
    client.emit(ev.renamed("ses_remote1", "New session - 2026-09-29T10:59:18.048Z"));
    const still = h.store.getSession(sid);
    expect(still.ok && still.data.title).toBe("tolong jelaskan cara kerja rate limiting di…");

    // Judul hasil generate opencode menggantikan judul sementara.
    client.emit(ev.renamed("ses_remote1", "Cara Kerja Rate Limiting di Express"));
    const final = h.store.getSession(sid);
    expect(final.ok && final.data.title).toBe("Cara Kerja Rate Limiting di Express");
    expect(h.titles.map(([, t]) => t)).toEqual([
      "tolong jelaskan cara kerja rate limiting di…",
      "Cara Kerja Rate Limiting di Express",
    ]);

    // Prompt kedua tidak mengubah judul lagi.
    await h.sm.sendFreeTextInput(sid, "lanjut ke nestjs");
    const after = h.store.getSession(sid);
    expect(after.ok && after.data.title).toBe("Cara Kerja Rate Limiting di Express");
  } finally {
    h.close();
  }
});

test("session.updated child sub-agent -> judul Session akar tidak tertimpa", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.child("ses_child1", "ses_remote1"));

    // Sub-agent meng-generate judulnya sendiri — bukan judul percakapan user.
    client.emit(ev.renamed("ses_child1", "Judul sub-agent"));
    const sess = h.store.getSession(sid);
    expect(sess.ok).toBe(true);
    if (sess.ok) expect(sess.data.title).toBeNull();
    expect(h.titles).toHaveLength(0);

    // Judul akar tetap sampai setelah event child.
    client.emit(ev.renamed("ses_remote1", "Judul asli"));
    expect(h.titles).toEqual([[sid, "Judul asli"]]);
  } finally {
    h.close();
  }
});

test("session.updated session tak dikenal / info rusak -> diabaikan", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const client = clientOf(h);

    client.emit(ev.renamed("ses_asing", "bukan milik KCG Code"));
    client.emit(ev.renamed("ses_remote1", "   "));

    expect(h.titles).toHaveLength(0);
    expect(h.store.listSessions().every((s) => s.title === null)).toBe(true);
  } finally {
    h.close();
  }
});
