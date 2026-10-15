/**
 * Unit test jawaban kartu prompt (`sessions/prompt-resolver.ts`):
 * `resolvePrompt` -> `permission.reply` / `form.reply|cancel`, fan-out ke
 * kartu kembar, multi-question, dan request yang sudah dilupakan agent.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import type { InteractivePrompt } from "../../../../types";
import { clientOf, createSession, ev, freshHarness, type Harness, qField } from "./harness";

async function seedPrompt(
  h: Harness,
  sid: string,
  kind: "permission" | "question",
  id: string,
): Promise<string> {
  const prompt: InteractivePrompt = {
    id,
    sessionId: sid,
    kind,
    type: kind === "permission" ? "confirmation" : "menu",
    title: kind === "permission" ? "bash:ls" : "Pilih opsi",
    options:
      kind === "permission"
        ? null
        : [
            { label: "A", description: null },
            { label: "B", description: null },
          ],
    status: "pending",
    createdAt: 1,
    resolvedAt: null,
  };
  const ins = h.store.insertPrompt(prompt);
  expect(ins.ok).toBe(true);
  return prompt.id;
}

test("resolvePrompt permission: approve -> once; deny/cancel -> reject; lalu resolved", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    const pid1 = await seedPrompt(h, sid, "permission", "per_1");
    const r1 = await h.sm.resolvePrompt(sid, pid1, "approve");
    expect(r1.ok).toBe(true);
    expect(client.calls).toContain("permission.reply:per_1:once");

    const pid2 = await seedPrompt(h, sid, "permission", "per_2");
    await h.sm.resolvePrompt(sid, pid2, "deny");
    expect(client.calls).toContain("permission.reply:per_2:reject");

    const pid3 = await seedPrompt(h, sid, "permission", "per_3");
    await h.sm.resolvePrompt(sid, pid3, "cancel");
    expect(client.calls).toContain("permission.reply:per_3:reject");

    // Semua resolved.
    for (const id of [pid1, pid2, pid3]) {
      const p = h.store.getPrompt(id);
      expect(p.ok && p.data.status).toBe("resolved");
    }
  } finally {
    h.close();
  }
});

test("resolvePrompt question: option -> replyQuestion; cancel -> rejectQuestion", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    const pid1 = await seedPrompt(h, sid, "question", "que_1");
    const r1 = await h.sm.resolvePrompt(sid, pid1, { option: "A" });
    expect(r1.ok).toBe(true);
    expect(client.calls).toContain("form.reply:que_1:A");

    // Jawaban question TIDAK di-echo ke riwayat chat (transcript bersih).
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);

    const pid2 = await seedPrompt(h, sid, "question", "que_2");
    const r2 = await h.sm.resolvePrompt(sid, pid2, "cancel");
    expect(r2.ok).toBe(true);
    expect(client.calls).toContain("form.cancel:que_2");
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("resolvePrompt question multi-select -> replyQuestion dengan seluruh label terpilih", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Event question dengan multiple=true (skema tool `question` opencode).
    client.emit(
      ev.form("ses_remote1", "que_multi", [
        qField(
          0,
          "Mau eksplor bagian mana?",
          [
            { label: "Debug", description: "investigasi bug" },
            { label: "Config", description: "cek settings" },
            { label: "Monitor", description: "logs & performa" },
          ],
          { multiple: true },
        ),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = h.prompts[0] as InteractivePrompt;
    expect(p.multiple).toBe(true);
    // Description per opsi ikut tersimpan, tidak dibuang lagi.
    expect(p.options).toEqual([
      { label: "Debug", description: "investigasi bug" },
      { label: "Config", description: "cek settings" },
      { label: "Monitor", description: "logs & performa" },
    ]);

    // Jawaban multi-select: seluruh label dalam SATU panggilan reply.
    const r = await h.sm.resolvePrompt(sid, "que_multi", { options: ["Debug", "Monitor"] });
    expect(r.ok).toBe(true);
    expect(client.calls).toContain("form.reply:que_multi:Debug,Monitor");
  } finally {
    h.close();
  }
});

test("event question multi-question -> prompt.questions lengkap; jawaban per pertanyaan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Satu request berisi DUA pertanyaan (skema tool `question` opencode).
    client.emit(
      ev.form("ses_remote1", "que_batch", [
        qField(
          0,
          "Mau eksplor bagian mana?",
          [
            { label: "Debug", description: "investigasi bug" },
            { label: "Config", description: "cek settings" },
          ],
          { multiple: true },
        ),
        qField(1, "Kapan mulai?", ["Sekarang", "Nanti"]),
      ]),
    );

    expect(h.prompts).toHaveLength(1);
    const p = h.prompts[0] as InteractivePrompt;
    // Seluruh pertanyaan tersimpan; pertanyaan pertama juga di field legacy.
    expect(p.questions).toHaveLength(2);
    expect(p.questions?.[0]?.question).toBe("Mau eksplor bagian mana?");
    expect(p.questions?.[0]?.multiple).toBe(true);
    expect(p.questions?.[1]?.question).toBe("Kapan mulai?");
    expect(p.title).toBe("Mau eksplor bagian mana?");
    expect(p.options?.map((o) => o.label)).toEqual(["Debug", "Config"]);

    // Jawaban batch: SATU array label per pertanyaan, urut sesuai questions.
    const r = await h.sm.resolvePrompt(sid, "que_batch", {
      answers: [["Debug", "Config"], ["Nanti"]],
    });
    expect(r.ok).toBe(true);
    // Reply API menerima array-of-array (skema Question.Reply).
    expect(client.calls).toContain("form.reply:que_batch:Debug,Config|Nanti");
  } finally {
    h.close();
  }
});

// Multi-question hanya disimpan bila ada >1 pertanyaan — request tunggal
// tidak menambah data duplikat di DB.
test("event question tunggal -> prompt.questions undefined", async () => {
  const h = freshHarness();
  try {
    await createSession(h);
    clientOf(h).emit(ev.form("ses_remote1", "que_satu", [qField(0, "Lanjut?", ["Ya"])]));
    expect(h.prompts).toHaveLength(1);
    expect((h.prompts[0] as InteractivePrompt).questions).toBeUndefined();
  } finally {
    h.close();
  }
});

test("resolvePrompt permission approve -> TIDAK di-echo ke chat", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const pid = await seedPrompt(h, sid, "permission", "per_echo");
    await h.sm.resolvePrompt(sid, pid, "approve");
    expect(h.messages.filter((m) => m.role === "user")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("resolvePrompt permission identik bertumpuk -> satu jawaban di-fan-out ke semuanya", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Tiga request identik (opencode memancarkan satu per tool call).
    for (const id of ["per_a", "per_b", "per_c"]) {
      client.emit(ev.permission("ses_remote1", id, "external_directory", ["D:\\Proj\\**"]));
    }
    expect(h.prompts).toHaveLength(3);

    // Satu klik Approve pada kartu grup -> ketiganya di-reply & resolved.
    const r = await h.sm.resolvePrompt(sid, "per_b", "approve");
    expect(r.ok).toBe(true);
    for (const id of ["per_a", "per_b", "per_c"]) {
      expect(client.calls).toContain(`permission.reply:${id}:once`);
      const p = h.store.getPrompt(id);
      expect(p.ok && p.data.status).toBe("resolved");
    }

    // Deny juga berlaku ke grup.
    for (const id of ["per_d", "per_e"]) {
      client.emit(ev.permission("ses_remote1", id, "external_directory", ["D:\\Proj\\**"]));
    }
    await h.sm.resolvePrompt(sid, "per_d", "deny");
    for (const id of ["per_d", "per_e"]) {
      expect(client.calls).toContain(`permission.reply:${id}:reject`);
      const p = h.store.getPrompt(id);
      expect(p.ok && p.data.status).toBe("resolved");
    }
    // Twin yang ikut resolved dilaporkan via hook (notif WS prompt_resolved).
    expect(h.promptResolved).toContainEqual([sid, "per_e"]);
  } finally {
    h.close();
  }
});

test("resolvePrompt always -> replyPermission always; opsi tak dikenal tetap diteruskan", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Always allow: opencode mengingat pola -> request identik berikutnya
    // tidak lagi menampilkan kartu.
    const pid = await seedPrompt(h, sid, "permission", "per_always");
    const r = await h.sm.resolvePrompt(sid, pid, "always");
    expect(r.ok).toBe(true);
    expect(client.calls).toContain("permission.reply:per_always:always");

    // Opsi menu tidak ada di daftar tersimpan TETAP diteruskan ke opencode
    // (validasi sebenarnya di server opencode) — menolak keras di sini
    // membuat tombol opsi terasa mati tanpa feedback.
    const qid = await seedPrompt(h, sid, "question", "que_opt");
    const r2 = await h.sm.resolvePrompt(sid, qid, { option: "OpsiLive" });
    expect(r2.ok).toBe(true);
    expect(client.calls).toContain("form.reply:que_opt:OpsiLive");
  } finally {
    h.close();
  }
});

test("resolvePrompt permission beda judul TIDAK ikut ter-fan-out", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    client.emit(ev.permission("ses_remote1", "per_bash", "bash", ["ls"]));
    client.emit(ev.permission("ses_remote1", "per_edit", "edit", ["src/a.ts"]));

    await h.sm.resolvePrompt(sid, "per_bash", "approve");
    expect(client.calls).toContain("permission.reply:per_bash:once");
    expect(client.calls).not.toContain("permission.reply:per_edit:once");
    const other = h.store.getPrompt("per_edit");
    expect(other.ok && other.data.status).toBe("pending");
  } finally {
    h.close();
  }
});

test("resolvePrompt: request dilupakan opencode (404) -> prompt ditutup lokal, PROMPT_EXPIRED", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // Jawab question yang sudah tidak ditunggu agent.
    const pid = await seedPrompt(h, sid, "question", "que_gone");
    client.goneRequests.add("que_gone");
    const r = await h.sm.resolvePrompt(sid, pid, { option: "A" });
    expect(r).toEqual({ ok: false, error: "PROMPT_EXPIRED" });
    // Baris tidak lagi pending -> kartu hilang & session tidak terkunci.
    const row = h.store.getPrompt(pid);
    expect(row.ok && row.data.status).toBe("resolved");
    expect(h.store.listPendingPrompts(sid)).toHaveLength(0);

    // Skip (reject) pada request yang hilang juga menutup prompt.
    const pid2 = await seedPrompt(h, sid, "question", "que_gone2");
    client.goneRequests.add("que_gone2");
    expect((await h.sm.resolvePrompt(sid, pid2, "cancel")).error).toBe("PROMPT_EXPIRED");
    expect(h.store.listPendingPrompts(sid)).toHaveLength(0);

    // Kegagalan lain (bukan 404) tetap pending agar bisa dicoba lagi.
    const pid3 = await seedPrompt(h, sid, "question", "que_ok");
    client.form.reply = async () => ({ ok: false, error: "AGENT_FORM_REPLY_FAILED: 500" });
    expect((await h.sm.resolvePrompt(sid, pid3, { option: "A" })).error).toBe(
      "AGENT_FORM_REPLY_FAILED: 500",
    );
    const row3 = h.store.getPrompt(pid3);
    expect(row3.ok && row3.data.status).toBe("pending");
  } finally {
    h.close();
  }
});

test("resolvePrompt invalid: tidak ditemukan / sudah resolved / respon salah", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const client = clientOf(h);

    // promptId tidak dikenal
    expect((await h.sm.resolvePrompt(sid, "nope", "approve")).error).toBe("PROMPT_NOT_FOUND");

    // sudah resolved
    const pid = await seedPrompt(h, sid, "permission", "per_1");
    await h.sm.resolvePrompt(sid, pid, "approve");
    expect((await h.sm.resolvePrompt(sid, pid, "approve")).error).toBe("PROMPT_ALREADY_RESOLVED");

    // opsi menu pada permission -> invalid
    const pid2 = await seedPrompt(h, sid, "permission", "per_2");
    expect((await h.sm.resolvePrompt(sid, pid2, { option: "x" })).error).toBe(
      "INVALID_PROMPT_RESPONSE",
    );

    // approve/deny pada question -> invalid
    const pid3 = await seedPrompt(h, sid, "question", "que_1");
    expect((await h.sm.resolvePrompt(sid, pid3, "approve")).error).toBe("INVALID_PROMPT_RESPONSE");
    // Hanya respon valid yang memicu reply; dua kasus invalid tidak.
    expect(
      client.calls.filter((c) => c.startsWith("permission.reply") || c.startsWith("form.reply")),
    ).toHaveLength(1);
  } finally {
    h.close();
  }
});
