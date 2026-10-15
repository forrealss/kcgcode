/**
 * Unit test siklus turn: penutupan oleh `session.execution.*`, timer idle
 * (`TURN_TIMEOUT`), `interruptSession`, retry, compact, aktivitas agent,
 * dan hook `onTurnEnd`.
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
  statusOf,
  textPart,
} from "./harness";

// ---------------------------------------------------------------------------
// Penutupan turn & timer idle
// ---------------------------------------------------------------------------

test("session.execution.failed menutup turn: parts tersimpan + pesan error + banner", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Parts sudah ter-stream sebelum error datang — harus tetap tersimpan.
    emitAll(client, [
      ev.step("ses_remote1", "msg_a1"),
      ...ev.text("ses_remote1", "msg_a1", "sebagian"),
    ]);

    // Agent gagal memproses prompt (mis. URL file gambar) — akhir eksekusi.
    client.emit(
      ev.failed(
        "ses_remote1",
        'TypeError: File URL host must be "localhost" or empty on linux\n    at SessionPrompt.resolveUserPart',
      ),
    );

    // Banner ramah (baris pertama), parts tersimpan, pesan error ditulis.
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe('TypeError: File URL host must be "localhost" or empty on linux');
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]?.parts).toEqual([textPart("msg_a1", "sebagian")]);
    expect(assistants[1]?.parts[0]?.type).toBe("error");
    expect(assistants[1]?.parts[0]?.text).toBe(h.errors[0]?.[1]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(2);

    // Akhir eksekusi berikutnya tidak menambah apa-apa — turn sudah ditutup.
    client.emit(ev.idle("ses_remote1"));
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  } finally {
    h.close();
  }
});

test("session.execution.failed tanpa turn aktif -> hanya onError, tidak menulis pesan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.emit(ev.failed("ses_remote1", "auth required", "provider.auth"));
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[1]).toContain("Model provider authentication failed");
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("TURN_TIMEOUT (idle tanpa tanda hidup) -> pesan error tersimpan + onError", async () => {
  const timers: (() => void)[] = [];
  const cleared: unknown[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      turnIdleTimeoutMs: 5000,
      setTimeoutFn: (cb) => {
        timers.push(cb);
        return timers.length;
      },
      clearTimeoutFn: (handle) => cleared.push(handle),
    },
  );
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    // Turn aktif, belum ada balasan — belum ada error.
    expect(timers).toHaveLength(1);
    expect(h.errors).toHaveLength(0);

    timers[0]?.();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe(
      "The model stopped responding — no activity for 5 minutes. Try sending the message again.",
    );
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([{ type: "error", text: h.errors[0]?.[1] }]);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(1);

    // Timer lama sudah di-clear saat reset/fire — tidak ada timer yatim.
    expect(cleared.length).toBeGreaterThanOrEqual(1);
  } finally {
    h.close();
  }
});

test("turn idle timer di-reset oleh tanda hidup (part streaming, status busy)", async () => {
  const timers: (() => void)[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      turnIdleTimeoutMs: 5000,
      setTimeoutFn: (cb) => {
        timers.push(cb);
        return timers.length;
      },
      clearTimeoutFn: () => {},
    },
  );
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    expect(timers).toHaveLength(1); // timer awal

    const fireFirst = timers[0];

    // Tanda hidup #1: step baru + part teks — timer di-reset 2x.
    emitAll(client, [
      ev.step("ses_remote1", "msg_a1"),
      ...ev.text("ses_remote1", "msg_a1", "menulis lama..."),
    ]);
    expect(timers).toHaveLength(3); // timer awal + 2 reset

    // Timer LAMA terpicu (race): tidak boleh menggagalkan turn yang hidup.
    fireFirst?.();
    expect(h.errors).toHaveLength(0);
    expect(h.turns).toEqual([[sid, true]]);

    // Tanda hidup #2: aktivitas agent (tool lama, dsb.) juga me-reset timer.
    client.emit(ev.activity("ses_remote1"));
    expect(timers).toHaveLength(4);

    // Timer lama (hasil reset) tidak menggagalkan turn — turn tetap hidup.
    timers[1]?.();
    timers[2]?.();
    expect(h.errors).toHaveLength(0);

    // Timer yang terpasang sekarang (terakhir) terpicu -> turn gagal idle.
    timers[3]?.();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[1]).toBe(
      "The model stopped responding — no activity for 5 minutes. Try sending the message again.",
    );
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("turn idle timer DITUNDA selama kartu permission pending (user sedang memutus)", async () => {
  const timers: (() => void)[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      turnIdleTimeoutMs: 5000,
      setTimeoutFn: (cb) => {
        timers.push(cb);
        return timers.length;
      },
      clearTimeoutFn: () => {},
    },
  );
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "perbaiki deps");
    await flush();
    expect(timers).toHaveLength(1);

    // Turn meminta izin — agent hidup MENUNGGU keputusan user.
    client.emit(ev.permission("ses_remote1", "per_idle1", "bash", ["bun install"]));
    expect(h.prompts).toHaveLength(1);

    // Timer terpicu saat kartu masih pending -> DITUNDA (re-arm, bukan fail).
    timers[0]?.();
    expect(h.errors).toHaveLength(0);
    expect(h.turns).toEqual([[sid, true]]);
    expect(timers).toHaveLength(2); // timer dipasang ulang

    // User menjawab kartu -> tidak ada pending lagi.
    const resolved = await h.sm.resolvePrompt(sid, "per_idle1", "approve");
    expect(resolved.ok).toBe(true);

    // Timer yang dipasang ulang kini boleh memicu fail idle.
    timers[1]?.();
    expect(h.errors).toHaveLength(1);
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("session.idle ganda -> turn hanya difinalisasi sekali", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sekali"));

    client.emit(ev.idle("ses_remote1"));
    client.emit(ev.idle("ses_remote1"));

    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("session.idle tanpa parts assistant -> tidak menyimpan pesan kosong", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit(ev.idle("ses_remote1"));

    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("stopSession di tengah turn menyimpan parts yang sudah ter-stream", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "separuh jalan"));

    expect(h.sm.stopSession(sid).ok).toBe(true);

    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts[0]?.text).toBe("separuh jalan");
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// interruptSession (hentikan balasan saja — Session tetap running)
// ---------------------------------------------------------------------------

test("interruptSession: turn dimulai -> turn_active true; selesai -> false", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Turn belum ada -> tanpa notifikasi.
    expect(h.turns).toHaveLength(0);

    await h.sm.sendFreeTextInput(sid, "hello");
    expect(h.turns).toEqual([[sid, true]]);

    // session.idle menutup turn -> turn_active false.
    client.emit(ev.idle("ses_remote1"));
    expect(h.turns).toEqual([
      [sid, true],
      [sid, false],
    ]);
  } finally {
    h.close();
  }
});

test("interruptSession: abort remote + BUANG parts parsial (tidak disimpan); session tetap running", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "separuh jalan"));

    const res = h.sm.interruptSession(sid);
    expect(res.ok).toBe(true);

    // Turn remote di-abort.
    expect(client.calls).toContain("session.interrupt:ses_remote1");
    // User membatalkan balasan -> parts parsial TIDAK disimpan (tidak muncul
    // di riwayat / tidak di-broadcast sebagai pesan assistant).
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(0);
    // Turn ditutup (turn_active false).
    expect(h.turns).toContainEqual([sid, false]);

    // Beda dari stopSession: status TETAP running (tanpa resume).
    expect(statusOf(h.store, sid)).toBe("running");
    expect(h.statuses).toHaveLength(0);

    // Bisa langsung kirim pesan baru tanpa Start ulang.
    const next = await h.sm.sendFreeTextInput(sid, "lanjut");
    expect(next.ok).toBe(true);
    expect(h.turns).toContainEqual([sid, true]);
  } finally {
    h.close();
  }
});

test("interruptSession tanpa turn aktif -> no-op, session tetap running", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const res = h.sm.interruptSession(sid);
    expect(res.ok).toBe(true);
    expect(statusOf(h.store, sid)).toBe("running");
    // Tanpa turn tidak ada broadcast apapun.
    expect(h.turns).toHaveLength(0);
    expect(h.messages).toHaveLength(0);
    // Idempoten: boleh dipanggil lagi.
    expect(h.sm.interruptSession(sid).ok).toBe(true);
  } finally {
    h.close();
  }
});

test("interruptSession: session tak dikenal -> SESSION_NOT_FOUND", () => {
  const h = freshHarness();
  try {
    expect(h.sm.interruptSession("tidak-ada").error).toBe("SESSION_NOT_FOUND");
  } finally {
    h.close();
  }
});

test("session.execution.interrupted setelah interrupt -> tanpa banner error", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    h.sm.interruptSession(sid);

    // Server mengonfirmasi turn dibatalkan (bukan kegagalan nyata).
    client.emit(ev.interrupted("ses_remote1"));
    expect(h.errors).toHaveLength(0);
    const stored = h.store.getMessages(sid);
    expect(stored.ok && stored.data.filter((m) => m.role === "assistant")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("session.execution.interrupted dengan turn aktif -> turn ditutup tanpa pesan error", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Parts sudah ter-stream sebelum opencode mengabort turn.
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sebagian"));
    client.emit(ev.interrupted("ses_remote1"));

    // Parts tersimpan, TAPI tanpa pesan error & tanpa banner onError.
    expect(h.errors).toHaveLength(0);
    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts).toEqual([textPart("msg_a1", "sebagian")]);
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// Retry, compact & aktivitas agent
// ---------------------------------------------------------------------------

test("session.retry.scheduled -> onError banner ramah, turn tetap hidup sampai selesai", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    // Provider error yang bisa di-retry: agent memancarkan
    // `session.retry.scheduled` — turn BELUM ditutup, tapi Client diberi tahu
    // kenapa balasan lambat (bukan menunggu diam-diam).
    client.emit(ev.retry("ses_remote1", 'Command Code API error 400: {"success":false}', 1));
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.[0]).toBe(sid);
    expect(h.errors[0]?.[1]).toBe(
      'The model provider is retrying (attempt 1): Command Code API error 400: {"success":false}',
    );
    // Turn masih aktif — retry adalah backoff, bukan kegagalan final.
    expect(h.turns).toEqual([[sid, true]]);
    expect(h.messages.filter((m) => m.role === "assistant")).toHaveLength(0);

    // Pesan retry hanya baris pertama (sisanya sering body JSON panjang).
    client.emit(ev.retry("ses_remote1", ["Free limit reached", '{"raw":"body"}'].join("\n"), 2));
    expect(h.errors[1]?.[1]).toBe("The model provider is retrying (attempt 2): Free limit reached");

    // Retry sukses -> turn ditutup normal oleh akhir eksekusi (tanpa pesan error).
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "akhirnya jawaban"));
    client.emit(ev.idle("ses_remote1"));

    const assistants = h.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts[0]?.text).toBe("akhirnya jawaban");
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

test("compact: status compacting via hook & context; penanda tersimpan; gagal -> banner", async () => {
  const changes: [string, boolean][] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    { onCompactionChange: (id, on) => changes.push([id, on]) },
  );
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    client.usage = {
      usedTokens: 50_000,
      maxTokens: 200_000,
      percent: 25,
      autoCompactAt: null,
      model: "m",
      categories: [],
      measuredAt: 1,
    };
    await h.sm.sendFreeTextInput(sid, "/compact");
    await flush();
    client.emit(ev.step("ses_remote1", "msg_a1"));
    client.emit({
      type: "agent.compaction",
      data: { sessionID: "ses_remote1", phase: "started", trigger: "manual" },
    });
    const during = await h.sm.sessionContext(sid);
    expect(during.ok && [during.data.compacting, during.data.usage?.percent]).toEqual([true, 25]);
    client.emit({
      type: "agent.compaction",
      data: {
        sessionID: "ses_remote1",
        phase: "ended",
        trigger: "manual",
        assistantMessageID: "msg_a1",
        preTokens: 33_333,
        postTokens: 3_847,
      },
    });
    client.emit(ev.idle("ses_remote1"));
    expect(changes).toEqual([
      [sid, true],
      [sid, false],
    ]);
    const after = await h.sm.sessionContext(sid);
    expect(after.ok && after.data.compacting).toBe(false);
    const assistant = h.messages.find((m) => m.role === "assistant");
    expect(assistant?.parts).toEqual([
      {
        id: "prt_msg_a1_compaction_0",
        type: "compaction",
        trigger: "manual",
        preTokens: 33_333,
        postTokens: 3_847,
        time: { created: 1000 },
        messageID: "msg_a1",
      },
    ]);
    expect(h.errors).toEqual([]);

    // Compact gagal -> banner; dibatalkan user -> tanpa banner.
    client.emit({
      type: "agent.compaction",
      data: {
        sessionID: "ses_remote1",
        phase: "failed",
        trigger: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact" },
      },
    });
    client.emit({
      type: "agent.compaction",
      data: {
        sessionID: "ses_remote1",
        phase: "failed",
        trigger: "manual",
        error: { type: "aborted", message: "x" },
      },
    });
    expect(h.errors).toEqual([[sid, "Couldn't compact the conversation: Nothing to compact"]]);
  } finally {
    h.close();
  }
});

test("compact tanpa pesan assistant (opencode) -> penanda di pesan tersendiri", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "/compact");
    await flush();
    client.emit({
      type: "agent.compaction",
      data: { sessionID: "ses_remote1", phase: "ended", trigger: "manual", preTokens: 9_000 },
    });
    client.emit(ev.idle("ses_remote1"));
    const assistant = h.messages.find((m) => m.role === "assistant");
    expect(assistant?.id).toBe("msg_compaction_ses_remote1_1000");
    expect(assistant?.parts.map((p) => [p.type, p.preTokens])).toEqual([["compaction", 9_000]]);
  } finally {
    h.close();
  }
});

test("agent.activity / step tanpa konten -> tanpa banner, tanpa efek", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();

    client.emit(ev.activity("ses_remote1"));
    client.emit({
      type: "session.step.ended",
      data: { sessionID: "ses_remote1", assistantMessageID: "msg_x", finish: "stop" },
    });
    expect(h.errors).toHaveLength(0);

    // Turn tetap ditutup oleh akhir eksekusi seperti biasa.
    client.emit(ev.idle("ses_remote1"));
    expect(h.turns).toContainEqual([sid, false]);
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// onTurnEnd — sumber notifikasi "agent selesai"
// ---------------------------------------------------------------------------

test("onTurnEnd: idle -> done; interrupt user tidak memicu notifikasi", async () => {
  const ended: [string, string][] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    { onTurnEnd: (id, outcome) => ended.push([id, outcome]) },
  );
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "hello");
    await flush();
    const client = clientOf(h);
    client.emit(ev.idle("ses_remote1"));
    expect(ended).toEqual([[sid, "done"]]);

    // Turn kedua dihentikan user -> diam.
    await h.sm.sendFreeTextInput(sid, "again");
    await flush();
    h.sm.interruptSession(sid);
    client.emit(ev.idle("ses_remote1"));
    expect(ended).toEqual([[sid, "done"]]);
  } finally {
    h.close();
  }
});
