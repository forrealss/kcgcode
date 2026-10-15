/**
 * Unit test handler pesan Client (`gateway/client-actions.ts`):
 * - attach: history berisi `messages` + `prompts` pending (4.1, 4.4);
 *   Session tak dikenal -> error + close (4.3).
 * - input / prompt_response / stop / interrupt: diteruskan ke
 *   Session_Manager; error domain -> pesan `error` ke Client pengirim.
 * - `dispatchClientMessage` mengarahkan pesan ke handler yang tepat.
 *
 * `Subscriber` (ws.send) dan `SessionManager` di-mock; store `bun:sqlite`
 * asli sesuai batasan mocking `design.md`. Harness bersama ada di
 * `harness.ts`.
 */
import { expect, test } from "bun:test";
import fc from "fast-check";
import { ErrorCodes, type ServerMessage } from "../../../../ws-protocol";
import { dispatchClientMessage } from "../../ws-transport";
import { freshHarness, type HistoryMsg, makeMessage, makePrompt, makeSub } from "./harness";

// ---------------------------------------------------------------------------
// Attach
// ---------------------------------------------------------------------------

test("attach: history berisi messages terurut + prompts pending (4.1, 4.4)", () => {
  const h = freshHarness();
  try {
    h.store.insertMessage(makeMessage("s1", "m1", "user"));
    h.store.insertMessage(makeMessage("s1", "m2", "assistant"));
    h.store.insertPrompt(makePrompt("s1", "pr1", "permission"));
    h.store.insertPrompt(makePrompt("s1", "pr2", "question"));
    h.store.updatePromptStatus("pr2", "resolved", 5);

    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    const hist = sub.sent.find((m): m is HistoryMsg => m.type === "history");
    expect(hist).toBeDefined();
    if (hist) {
      expect(hist.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
      expect(hist.prompts.map((p) => p.id)).toEqual(["pr1"]); // hanya pending
    }
    expect(h.gw.subscriberCount("s1")).toBe(1);
  } finally {
    h.close();
  }
});

test("attach session tak dikenal -> error SESSION_NOT_FOUND + close, tanpa history (4.3)", () => {
  fc.assert(
    // minLength 1: `""` adalah mode daftar (tanpa error), bukan id tak dikenal.
    fc.property(fc.string({ minLength: 1, maxLength: 20 }), (unknownId) => {
      const h = freshHarness();
      try {
        const sub = makeSub("c1");
        h.gw.attach(sub, unknownId);
        const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
          return m.type === "error";
        });
        expect(err).toBeDefined();
        if (err) expect(err.code).toBe(ErrorCodes.SESSION_NOT_FOUND);
        expect(sub.closed).toBe(true);
        expect(sub.sent.some((m) => m.type === "history")).toBe(false);
        expect(h.gw.subscriberCount(unknownId)).toBe(0);
      } finally {
        h.close();
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Wire pesan Client -> Session_Manager
// ---------------------------------------------------------------------------

test("input diteruskan; input invalid -> error INVALID_TEXT", async () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.input(sub, "s1", "hello");
    await Bun.sleep(0);
    expect(h.sm.inputs).toEqual([["s1", "hello"]]);

    h.sm.inputResult = { ok: false, error: "TEXT_EMPTY" };
    h.gw.input(sub, "s1", "   ");
    await Bun.sleep(0);
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.INVALID_TEXT);
  } finally {
    h.close();
  }
});

test("prompt_response sukses -> notify prompt_resolved; gagal -> error", async () => {
  const h = freshHarness();
  try {
    h.store.insertPrompt(makePrompt("s1", "pr1", "permission"));
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.promptResponse(sub, "s1", "pr1", "approve");
    await Bun.sleep(0);
    expect(h.sm.promptReplies).toEqual([["s1", "pr1", "approve"]]);
    const resolved = sub.sent.filter(
      (m): m is Extract<ServerMessage, { type: "prompt_resolved" }> => m.type === "prompt_resolved",
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.promptId).toBe("pr1");

    // Gagal -> error berkode PROMPT_FAILED (ditampilkan DI kartu oleh client)
    // dengan pesan ramah, tanpa notif resolved.
    h.sm.resolveResult = { ok: false, error: "PROMPT_NOT_FOUND" };
    h.gw.promptResponse(sub, "s1", "pr2", "approve");
    await Bun.sleep(0);
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) {
      expect(err.code).toBe(ErrorCodes.PROMPT_FAILED);
      expect(err.message).toContain("no longer waiting");
    }
    expect(sub.sent.filter((m) => m.type === "prompt_resolved")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("prompt_response kedaluwarsa (PROMPT_EXPIRED) -> kartu dihapus + error PROMPT_EXPIRED", async () => {
  const h = freshHarness();
  try {
    h.store.insertPrompt(makePrompt("s1", "pr_gone", "question"));
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");
    sub.sent.length = 0;

    h.sm.resolveResult = { ok: false, error: "PROMPT_EXPIRED" };
    h.gw.promptResponse(sub, "s1", "pr_gone", { option: "A" });
    await Bun.sleep(0);

    // Kartu dihapus di klien (prompt_resolved) supaya session tidak terkunci.
    const resolved = sub.sent.filter(
      (m): m is Extract<ServerMessage, { type: "prompt_resolved" }> => m.type === "prompt_resolved",
    );
    expect(resolved.map((m) => m.promptId)).toEqual(["pr_gone"]);
    const err = sub.sent.find(
      (m): m is Extract<ServerMessage, { type: "error" }> => m.type === "error",
    );
    expect(err?.code).toBe(ErrorCodes.PROMPT_EXPIRED);
    expect(err?.message).toContain("stopped waiting");
  } finally {
    h.close();
  }
});

test("prompt_response multi-select { options } -> diteruskan utuh ke manager", async () => {
  const h = freshHarness();
  try {
    h.store.insertPrompt(makePrompt("s1", "que_m", "question"));
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.promptResponse(sub, "s1", "que_m", { options: ["A", "B"] });
    await Bun.sleep(0);
    expect(h.sm.promptReplies).toEqual([["s1", "que_m", { options: ["A", "B"] }]]);
  } finally {
    h.close();
  }
});

test("stop diteruskan; session tidak running -> error SESSION_NOT_RUNNING", () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.stop(sub, "s1");
    expect(h.sm.stops).toEqual(["s1"]);

    h.sm.stopResult = { ok: false, error: "SESSION_NOT_RUNNING" };
    h.gw.stop(sub, "s1");
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.SESSION_NOT_RUNNING);
  } finally {
    h.close();
  }
});

test("interrupt diteruskan ke interruptSession; gagal -> error dikirim", () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");

    h.gw.interrupt(sub, "s1");
    expect(h.sm.interrupts).toEqual(["s1"]);

    h.sm.interruptResult = { ok: false, error: "SESSION_NOT_FOUND" };
    h.gw.interrupt(sub, "s1");
    const err = sub.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe(ErrorCodes.SESSION_NOT_FOUND);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Dispatch pesan Client
// ---------------------------------------------------------------------------

test("dispatchClientMessage mengarahkan attach/input/prompt_response/stop/error", async () => {
  const h = freshHarness();
  try {
    const sub = makeSub("d1");
    dispatchClientMessage(h.gw, sub, JSON.stringify({ type: "attach", sessionId: "s1" }));
    expect(sub.sent.some((m) => m.type === "history")).toBe(true);

    dispatchClientMessage(
      h.gw,
      sub,
      JSON.stringify({ type: "input", sessionId: "s1", text: "halo" }),
    );
    await Bun.sleep(0);
    expect(h.sm.inputs).toEqual([["s1", "halo"]]);

    dispatchClientMessage(
      h.gw,
      sub,
      JSON.stringify({
        type: "prompt_response",
        sessionId: "s1",
        promptId: "p",
        response: "approve",
      }),
    );
    await Bun.sleep(0);
    expect(h.sm.promptReplies).toEqual([["s1", "p", "approve"]]);

    dispatchClientMessage(h.gw, sub, JSON.stringify({ type: "stop", sessionId: "s1" }));
    expect(h.sm.stops).toEqual(["s1"]);

    dispatchClientMessage(h.gw, sub, JSON.stringify({ type: "interrupt", sessionId: "s1" }));
    expect(h.sm.interrupts).toEqual(["s1"]);

    // interrupt tanpa sessionId -> INVALID_MESSAGE.
    dispatchClientMessage(h.gw, makeSub("d4"), JSON.stringify({ type: "interrupt" }));
    expect(h.sm.interrupts).toEqual(["s1"]);

    // JSON rusak / tipe tak dikenal
    const sub2 = makeSub("d2");
    dispatchClientMessage(h.gw, sub2, "bukan-json");
    expect(sub2.sent.some((m) => m.type === "error")).toBe(true);

    const sub3 = makeSub("d3");
    dispatchClientMessage(h.gw, sub3, JSON.stringify({ type: "bogus" }));
    const err = sub3.sent.find((m): m is Extract<ServerMessage, { type: "error" }> => {
      return m.type === "error";
    });
    expect(err).toBeDefined();
    if (err) expect(err.code).toBe("UNKNOWN_MESSAGE_TYPE");
  } finally {
    h.close();
  }
});
