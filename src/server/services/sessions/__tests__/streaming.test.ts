/**
 * Unit test streaming part assistant (`sessions/projector-wiring.ts`):
 * event `session.step` / `session.text` / `session.reasoning` diteruskan
 * lewat `onMessagePart` / `onMessagePartDelta` selama turn aktif.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { clientOf, createSession, emitAll, ev, flush, freshHarness, textPart } from "./harness";

test("streaming: part assistant di-forward via onMessagePart setelah turn aktif", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Turn dimulai (sendFreeTextInput membuat entry turn streaming).
    await h.sm.sendFreeTextInput(sid, "hitung 2+2");

    // Step baru: pesan assistant mulai.
    client.emit(ev.step("ses_remote1", "msg_a1"));
    // Reasoning lalu teks.
    emitAll(client, ev.reasoning("ses_remote1", "msg_a1", "pikir..."));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "jawaban"));

    expect(h.messageParts).toHaveLength(2);
    expect(h.messageParts[0]).toEqual([
      sid,
      "msg_a1",
      textPart("msg_a1", "pikir...", 0, "reasoning"),
    ]);
    expect(h.messageParts[1]).toEqual([sid, "msg_a1", textPart("msg_a1", "jawaban")]);
  } finally {
    h.close();
  }
});

test("streaming: session.text.delta di-forward & terakumulasi", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "halo");

    client.emit(ev.step("ses_remote1", "msg_a1"));
    client.emit(ev.textStarted("ses_remote1", "msg_a1"));
    // Part dikirim (teks kosong) saat token pertama tiba, lalu delta per token.
    for (const delta of ["Ku", "cing ", "lucu."]) {
      client.emit(ev.textDelta("ses_remote1", "msg_a1", delta));
    }
    const partId = "prt_msg_a1_text_0";
    expect(h.messageParts).toEqual([
      [
        sid,
        "msg_a1",
        { id: partId, type: "text", text: "", time: { start: 1000 }, messageID: "msg_a1" },
      ],
    ]);

    // Tiap delta diteruskan ke Client apa adanya (bukan teks penuh).
    expect(h.partDeltas).toEqual([
      [sid, "msg_a1", partId, "text", "Ku"],
      [sid, "msg_a1", partId, "text", "cing "],
      [sid, "msg_a1", partId, "text", "lucu."],
    ]);

    // Tanpa `ended` pun, teks yang tersimpan saat eksekusi selesai tetap utuh.
    client.emit(ev.idle("ses_remote1"));
    const assistant = h.messages.find((m) => m.role === "assistant");
    expect(assistant?.parts).toEqual([
      {
        id: partId,
        type: "text",
        text: "Kucing lucu.",
        time: { start: 1000 },
        messageID: "msg_a1",
      },
    ]);
  } finally {
    h.close();
  }
});

test("streaming: delta kosong / pesan bukan milik turn diabaikan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    await h.sm.sendFreeTextInput(sid, "halo");
    client.emit(ev.step("ses_remote1", "msg_a1"));
    // Delta kosong -> tidak ada part/delta.
    client.emit(ev.textDelta("ses_remote1", "msg_a1", ""));
    // Pesan bukan milik turn (mis. pesan user) -> diabaikan.
    client.emit(ev.textDelta("ses_remote1", "msg_user", "y"));
    expect(h.partDeltas).toHaveLength(0);
    expect(h.messageParts).toHaveLength(0);
    expect(sid).toBeTruthy();
  } finally {
    h.close();
  }
});

test("streaming: part user / sebelum assistant dikenal tidak di-forward", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "hitung 2+2");

    // Part datang SEBELUM assistant dikenal -> diabaikan.
    emitAll(client, ev.text("ses_remote1", "msg_user1", "user echo"));
    expect(h.messageParts).toHaveLength(0);

    // Assistant dikenal -> hanya part dengan messageID yang sama diteruskan.
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_lain", "salah"));
    expect(h.messageParts).toHaveLength(0);

    emitAll(client, ev.text("ses_remote1", "msg_a1", "benar"));
    expect(h.messageParts).toHaveLength(1);
    expect(h.messageParts[0]?.[1]).toBe("msg_a1");
  } finally {
    h.close();
  }
});

test("streaming: satu turn dengan beberapa pesan assistant (sub-agent) di-stream semua", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "hitung 2+2");

    // Dua pesan assistant dalam satu turn (mis. sub-agent memancarkan pesan sendiri).
    client.emit(ev.step("ses_remote1", "msg_a1"));
    client.emit(ev.step("ses_remote1", "msg_a2"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "satu"));
    emitAll(client, ev.text("ses_remote1", "msg_a2", "dua"));

    expect(h.messageParts).toHaveLength(2);
    expect(h.messageParts.map(([, mid]) => mid).sort()).toEqual(["msg_a1", "msg_a2"]);
  } finally {
    h.close();
  }
});

test("streaming: turn lama selesai tidak menghapus turn baru (race guard)", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    // Dua input berurutan dengan jeda prompt_async berbeda (40ms lalu 500ms).
    // Input kedua men-finalisasi turn pertama dan memasang entry turn 2;
    // penyelesaian prompt_async turn 1 yang menyusul tidak boleh menghapus
    // entry milik turn 2.
    const client = clientOf(h);
    client.promptDelays = [40, 500];

    await h.sm.sendFreeTextInput(sid, "input pertama");
    await h.sm.sendFreeTextInput(sid, "input kedua");
    client.emit(ev.step("ses_remote1", "msg_b1"));
    emitAll(client, ev.text("ses_remote1", "msg_b1", "lanjutan"));
    expect(h.messageParts).toHaveLength(1);

    // Tunggu prompt_async pertama selesai (40ms) — yang kedua masih berjalan.
    await Bun.sleep(100);

    // Turn kedua harus tetap hidup walau turn pertama sudah selesai lebih dulu.
    emitAll(client, ev.text("ses_remote1", "msg_b1", "lanjutan lagi"));
    expect(h.messageParts).toHaveLength(2);
    expect(h.messageParts[1]?.[1]).toBe("msg_b1");

    // Biarkan prompt_async kedua selesai agar tidak ada timer menggantung.
    await Bun.sleep(500);
  } finally {
    h.close();
  }
});

test("streaming: turn tetap hidup setelah prompt_async, berakhir saat session.idle", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    await h.sm.sendFreeTextInput(sid, "hitung 2+2");
    client.emit(ev.step("ses_remote1", "msg_a1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sebagian"));
    expect(h.messageParts).toHaveLength(1);

    // prompt_async selesai (204) TIDAK mengakhiri turn — streaming berlanjut.
    await flush();
    emitAll(client, ev.text("ses_remote1", "msg_a1", "sebagian lanjutan"));
    expect(h.messageParts).toHaveLength(2);

    // session.idle menutup turn -> part berikutnya tidak lagi diteruskan.
    client.emit(ev.idle("ses_remote1"));
    emitAll(client, ev.text("ses_remote1", "msg_a1", "setelah idle"));
    expect(h.messageParts).toHaveLength(2);
  } finally {
    h.close();
  }
});
