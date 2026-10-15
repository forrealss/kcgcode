/**
 * Unit test broadcast `notify*` (`gateway/notifications.ts`): cakupan
 * koneksi yang attach Session (5.1, 5.2), semua koneksi, atau hanya koneksi
 * mode daftar (attach "").
 *
 * `Subscriber` (ws.send) dan `SessionManager` di-mock; store `bun:sqlite`
 * asli sesuai batasan mocking `design.md`. Harness bersama ada di
 * `harness.ts`.
 */
import { expect, test } from "bun:test";
import type { ServerMessage } from "../../../../ws-protocol";
import { dispatchClientMessage } from "../../ws-transport";
import { freshHarness, makeMessage, makePrompt, makeSub } from "./harness";

test("notify*: broadcast ke seluruh subscriber Session; bukan ke Session lain", () => {
  const h = freshHarness();
  try {
    // Session kedua untuk membuktikan isolasi per-Session.
    h.store.insertSession({
      id: "s2",
      projectId: "p1",
      agentType: "opencode",
      cwd: "/x",
      status: "running",
      ocSessionId: "ses_2",
      model: null,
      agent: null,
      title: null,
      createdAt: 0,
      updatedAt: 0,
    });

    const subs = [makeSub("c1"), makeSub("c2"), makeSub("other")] as const;
    h.gw.attach(subs[0], "s1");
    h.gw.attach(subs[1], "s1");
    h.gw.attach(subs[2], "s2");
    h.gw.notifyMessage("s1", makeMessage("s1", "m1", "assistant"));
    h.gw.notifyMessagePart("s1", "m1", { type: "text", id: "prt_1", text: "stream" });
    h.gw.notifyPrompt("s1", makePrompt("s1", "pr1", "permission"));
    h.gw.notifySessionStatus("s1", "stopped");
    h.gw.notifyTurnActive("s1", true);
    h.gw.notifyPromptResolved("s1", "pr1");
    h.gw.notifyError("s1", "AGENT_ERROR", "gagal");

    for (const s of [subs[0], subs[1]]) {
      expect(s.sent.filter((m) => m.type === "message")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "message_part")).toHaveLength(1);
      const part = s.sent.find((m): m is Extract<ServerMessage, { type: "message_part" }> => {
        return m.type === "message_part";
      });
      if (part) {
        expect(part.messageId).toBe("m1");
        expect(part.part).toEqual({ type: "text", id: "prt_1", text: "stream" });
      }
      const turn = s.sent.find(
        (m): m is Extract<ServerMessage, { type: "turn_active" }> => m.type === "turn_active",
      );
      expect(turn).toBeDefined();
      if (turn) expect(turn.active).toBe(true);
      expect(s.sent.filter((m) => m.type === "prompt")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "session_status")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "prompt_resolved")).toHaveLength(1);
      expect(s.sent.filter((m) => m.type === "error")).toHaveLength(1);
    }
    // Subscriber Session lain tidak menerima apa pun.
    expect(subs[2].sent.filter((m) => m.type === "message" || m.type === "prompt")).toHaveLength(0);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Mode daftar (attach "") + broadcast global
// ---------------------------------------------------------------------------

test('attach "" -> tanpa history; session_title di-broadcast ke semua koneksi', () => {
  const h = freshHarness();
  try {
    const listSub = makeSub("list");
    const listSub2 = makeSub("list2");
    const chatSub = makeSub("chat");
    h.gw.attach(listSub, "");
    h.gw.attach(listSub2, "");
    h.gw.attach(chatSub, "s1");

    // Mode daftar: terdaftar (terbukti dari broadcast di bawah), tanpa
    // history dan tanpa error.
    expect(listSub.closed).toBe(false);
    expect(listSub.sent).toHaveLength(0);

    h.gw.notifySessionTitle("s1", "Judul baru");
    expect(listSub.sent).toEqual([{ type: "session_title", sessionId: "s1", title: "Judul baru" }]);
    expect(listSub2.sent).toEqual([
      { type: "session_title", sessionId: "s1", title: "Judul baru" },
    ]);
    // Koneksi chat (attach satu Session) juga menerima — judul berguna di mana pun.
    expect(chatSub.sent.filter((m) => m.type === "session_title")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("isi percakapan (message) tidak sampai ke koneksi mode daftar", () => {
  const h = freshHarness();
  try {
    const listSub = makeSub("list");
    h.gw.attach(listSub, "");
    h.gw.notifyMessage("s1", makeMessage("s1", "m1", "assistant"));
    expect(listSub.sent).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("data_changed sampai ke semua koneksi (buat/hapus di perangkat lain)", () => {
  const h = freshHarness();
  try {
    const listSub = makeSub("list");
    h.gw.attach(listSub, "");
    const other = makeSub("other");
    h.gw.attach(other, "s1");
    other.sent.length = 0;

    h.gw.notifyDataChanged();

    expect(listSub.sent).toEqual([{ type: "data_changed" }]);
    expect(other.sent).toEqual([{ type: "data_changed" }]);
  } finally {
    h.close();
  }
});

test("session_status & session_deleted sampai ke semua koneksi (sidebar realtime)", () => {
  const h = freshHarness();
  try {
    const listSub = makeSub("list");
    h.gw.attach(listSub, "");
    const other = makeSub("other");
    h.gw.attach(other, "s1");
    other.sent.length = 0;

    h.gw.notifySessionStatus("s1", "stopped");
    h.gw.notifySessionDeleted("s1");

    // Koneksi mode daftar (sidebar / daftar Session) ikut menerima.
    expect(listSub.sent).toEqual([
      { type: "session_status", sessionId: "s1", status: "stopped" },
      { type: "session_deleted", sessionId: "s1" },
    ]);
    // Koneksi yang attach Session itu tetap menerima seperti biasa.
    expect(other.sent.map((m) => m.type)).toEqual(["session_status", "session_deleted"]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Notifikasi agent
// ---------------------------------------------------------------------------

test("notifyAgent hanya ke koneksi mode daftar; notify_ack diteruskan", () => {
  const h = freshHarness();
  try {
    const list = makeSub("list");
    h.gw.attach(list, "");
    const session = makeSub("session");
    h.gw.attach(session, "s1");
    session.sent.length = 0;

    const notification = {
      id: "n1",
      kind: "done" as const,
      sessionId: "s1",
      title: "Agent finished",
      body: "proj",
      url: "/projects/p1/sessions/s1",
      createdAt: 1,
    };
    h.gw.notifyAgent(notification);
    expect(list.sent).toEqual([{ type: "notify", notification }]);
    expect(session.sent).toEqual([]);

    dispatchClientMessage(
      h.gw,
      list,
      JSON.stringify({ type: "notify_ack", id: "n1", endpoint: "https://push.example.com/a" }),
    );
    expect(h.acks).toEqual([["n1", "https://push.example.com/a"]]);

    // Bentuk salah -> INVALID_MESSAGE, tidak diteruskan.
    const bad = makeSub("bad");
    dispatchClientMessage(h.gw, bad, JSON.stringify({ type: "notify_ack", id: 1 }));
    expect(bad.sent.some((m) => m.type === "error")).toBe(true);
    expect(h.acks).toHaveLength(1);
  } finally {
    h.close();
  }
});
