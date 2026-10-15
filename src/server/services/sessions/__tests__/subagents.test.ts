/**
 * Unit test sub-agent (`sessions/agent-session-map.ts`): child session
 * yang dibuat agent dipetakan ke Session lokal induk agar turn, streaming,
 * dan prompt izin-nya tidak terbuang.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { clientOf, createSession, emitAll, ev, flush, freshHarness, promptOf } from "./harness";

test("sub-agent: turn panjang dengan child session tersimpan utuh", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "delegasikan");
    await flush();

    // Sub-agent: child session ikut menyumbang pesan pada turn yang sama.
    emitAll(client, [
      ev.child("ses_child1", "ses_remote1"),
      ev.step("ses_remote1", "msg_induk"),
      ...ev.text("ses_remote1", "msg_induk", "memanggil sub-agent"),
      ev.step("ses_child1", "msg_child"),
      ...ev.text("ses_child1", "msg_child", "hasil sub-agent"),
    ]);

    // Child selesai TIDAK menutup turn (sub-agent selesai lebih dulu dari induk).
    client.emit(ev.idle("ses_child1"));
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);

    // Eksekusi Session akar selesai baru menutup turn.
    client.emit(ev.idle("ses_remote1"));
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants.map((m) => m.id)).toEqual(["msg_induk", "msg_child"]);

    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("sub-agent: permission.asked pada child session -> prompt untuk Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // opencode membuat child session saat model memanggil tool `task`.
    client.emit(ev.child("ses_child1", "ses_remote1"));

    // Izin yang diminta sub-agent memakai sessionID child.
    client.emit(ev.permission("ses_child1", "per_sub1", "bash", ["echo hi"]));

    expect(h.prompts).toHaveLength(1);
    const p = promptOf(h);
    expect(p.id).toBe("per_sub1");
    // Prompt diatribusikan ke Session lokal induk agar muncul di UI.
    expect(p.sessionId).toBe(sid);
  } finally {
    h.close();
  }
});

test("sub-agent: part child session di-stream ke Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "delegasikan ke sub-agent");
    client.emit(ev.child("ses_child1", "ses_remote1"));
    client.emit(ev.step("ses_child1", "msg_sub1"));
    emitAll(client, ev.text("ses_child1", "msg_sub1", "hasil sub-agent"));

    expect(h.messageParts).toHaveLength(1);
    expect(h.messageParts[0]?.[0]).toBe(sid);
    expect(h.messageParts[0]?.[1]).toBe("msg_sub1");
  } finally {
    h.close();
  }
});

test("sub-agent: child bersarang (cucu) tetap terpetakan ke Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    client.emit(ev.child("ses_child1", "ses_remote1"));
    // Sub-agent memanggil sub-agent lagi.
    client.emit(ev.child("ses_child2", "ses_child1"));
    client.emit(ev.permission("ses_child2", "per_deep", "edit", ["src/a.ts"]));

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]?.sessionId).toBe(sid);
  } finally {
    h.close();
  }
});

test("session.created tanpa parentID dikenal -> tidak dipetakan", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    const client = clientOf(h);

    // Session lain di server yang sama (mis. dibuat TUI) — bukan milik KCG Code.
    client.emit(ev.child("ses_asing", "ses_bukan_milik_kcgcode"));
    client.emit(ev.permission("ses_asing", "per_asing", "bash"));

    expect(h.prompts).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("stopSession melepas pemetaan child sub-agent", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.child("ses_child1", "ses_remote1"));

    expect(h.sm.stopSession(sid).ok).toBe(true);

    // Event child setelah stop tidak lagi menghasilkan prompt.
    client.emit(ev.permission("ses_child1", "per_setelah_stop", "bash"));
    expect(h.prompts).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("event permission.v2.asked pada child sub-agent -> prompt untuk Session induk", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.child("ses_child1", "ses_remote1"));
    client.emit(ev.permission("ses_child1", "per_v2_sub", "bash", ["echo sub"]));

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]?.sessionId).toBe(sid);
  } finally {
    h.close();
  }
});
