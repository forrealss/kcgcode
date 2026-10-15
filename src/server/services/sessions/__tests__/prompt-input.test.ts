/**
 * Unit test input prompt dengan lampiran (`sessions/prompt-input.ts`):
 * gambar & file upload menjadi part echo user + payload prompt agent, dan
 * lampiran ikut dibersihkan saat Session dihapus.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, test } from "bun:test";
import { clientOf, createSession, flush, freshHarnessWithHooks } from "./harness";

// ---------------------------------------------------------------------------
// Lampiran gambar (upload dari perangkat)
// ---------------------------------------------------------------------------

test("sendFreeTextInput dengan gambar -> echo user berisi part file image + promptAsync menerima ref gambar", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    // 1x1 PNG valid agar `attachment` tersimpan.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const saved = h.attachments?.save(sid, "foto.png", "image/png", png);
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(sid, "apa isi gambar ini?", [], [saved.data.id]);
    expect(res.ok).toBe(true);
    await flush();

    // Echo user disimpan + dikirim, memuat part file image + attachmentId.
    const user = h.messages.find((m) => m.role === "user");
    expect(user).toBeDefined();
    const imgPart = user?.parts.find((p) => p.type === "file" && p.attachmentId === saved.data.id);
    expect(imgPart).toBeDefined();
    expect(imgPart?.mime).toBe("image/png");
    expect(imgPart?.filename).toBe("foto.png");
    expect(typeof imgPart?.url).toBe("string");

    // promptAsync dipanggil dengan referensi file image (mime + url absolut).
    const files = client.promptFilesCalls.at(-1) ?? [];
    const ref = files.find((f) => f.name === "foto.png");
    expect(ref?.mime).toBe("image/png");
    // URL wajib absolut (`file:///…`): `file://rel/path` ditolak opencode.
    expect(ref?.uri.startsWith("file:///")).toBe(true);
    expect(ref?.uri).toContain(saved.data.id);
    // Part echo pun membawa URL absolut yang sama.
    expect(typeof imgPart?.url).toBe("string");
    expect((imgPart?.url ?? "").startsWith("file:///")).toBe(true);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput file non-gambar -> teks dikirim text/plain, biner hanya dirujuk lewat path", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const client = clientOf(h);
    const csv = h.attachments?.save(sid, "data.csv", "text/csv", new TextEncoder().encode("a,b"));
    const zip = h.attachments?.save(sid, "arsip.zip", "application/zip", new Uint8Array([1, 2]));
    if (!csv?.ok || !zip?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(sid, "cek ini", [], [csv.data.id, zip.data.id]);
    expect(res.ok).toBe(true);
    await flush();

    // Echo: kedua file tampil dengan mime aslinya (renderer memilih kartu).
    const user = h.messages.find((m) => m.role === "user");
    const echoed = (user?.parts ?? []).filter((p) => p.type === "file" && p.attachmentId);
    expect(echoed.map((p) => p.mime)).toEqual(["text/csv", "application/zip"]);
    // Teks tampilan tetap teks asli (catatan path tidak ikut di bubble).
    expect(user?.parts.find((p) => p.type === "text")?.text).toBe("cek ini");

    // Ke model: CSV jadi text/plain; ZIP tidak dikirim sebagai part.
    const files = client.promptFilesCalls.at(-1) ?? [];
    expect(files.map((f) => [f.name, f.mime])).toEqual([["data.csv", "text/plain"]]);
    // ...tapi path ZIP disebut di teks prompt agar model bisa memakai tool.
    const prompt = client.calls.filter((c) => c.startsWith("session.prompt:")).at(-1) ?? "";
    expect(prompt).toContain("cek ini");
    expect(prompt).toContain("arsip.zip");
    expect(prompt).toContain(zip.data.id);
  } finally {
    h.close();
  }
});

test("sendFreeTextInput gambar + @file -> part text + file image + file teks di echo", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const saved = h.attachments?.save(sid, "ss.png", "image/png", new Uint8Array([1, 2, 3]));
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(
      sid,
      "lihat @src/App.tsx",
      ["src/App.tsx"],
      [saved.data.id],
    );
    expect(res.ok).toBe(true);
    const user = h.messages.find((m) => m.role === "user");
    const parts = user?.parts ?? [];
    expect(parts.filter((p) => p.type === "text")).toHaveLength(1);
    expect(parts.filter((p) => p.type === "file" && p.attachmentId)).toHaveLength(1);
    expect(parts.filter((p) => p.type === "file" && !p.attachmentId)).toHaveLength(1);
    await flush();
  } finally {
    h.close();
  }
});

test("sendFreeTextInput: id gambar tak dikenal -> ATTACHMENT_NOT_FOUND tanpa echo", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const before = h.messages.length;
    const res = await h.sm.sendFreeTextInput(
      sid,
      "halo",
      [],
      ["00000000-0000-0000-0000-000000000000"],
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("ATTACHMENT_NOT_FOUND");
    expect(h.messages.length).toBe(before); // tidak ada echo
  } finally {
    h.close();
  }
});

test("sendFreeTextInput tanpa teks tapi ada gambar -> teks kosong diizinkan", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const saved = h.attachments?.save(sid, "x.webp", "image/webp", new Uint8Array([9]));
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");

    const res = await h.sm.sendFreeTextInput(sid, "  ", [], [saved.data.id]);
    expect(res.ok).toBe(true);
    const user = h.messages.find((m) => m.role === "user");
    expect(user?.parts.some((p) => p.type === "file" && p.attachmentId === saved.data.id)).toBe(
      true,
    );
    await flush();
  } finally {
    h.close();
  }
});

test("deleteSession membersihkan lampiran gambar Session", async () => {
  const h = freshHarnessWithHooks({}, { withAttachments: true });
  try {
    const sid = await createSession(h);
    const saved = h.attachments?.save(sid, "a.png", "image/png", new Uint8Array([1]));
    expect(saved?.ok).toBe(true);
    if (!saved?.ok) throw new Error("save gagal");
    expect(h.attachments?.info(sid, saved.data.id).ok).toBe(true);

    await h.sm.sendFreeTextInput(sid, "hapus nanti", [], [saved.data.id]);
    const res = await h.sm.deleteSession(sid);
    expect(res.ok).toBe(true);
    expect(h.attachments?.info(sid, saved.data.id).ok).toBe(false);
  } finally {
    h.close();
  }
});
