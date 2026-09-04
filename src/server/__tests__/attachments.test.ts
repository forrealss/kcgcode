/**
 * Unit test `attachments.ts` — Attachment_Store gambar upload.
 *
 * Yang diuji (tanpa server sungguhan):
 * - save hanya menerima mime gambar didukung + batas ukuran.
 * - id dibangkitkan server (UUID) dan path aman dari traversal.
 * - info/read mengembalikan metadata & bytes yang sama (round-trip).
 * - remove & removeSession membersihkan file.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAttachmentManager, MAX_UPLOAD_BYTES } from "../attachments";

function freshRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "kcg-attach-"));
}

function tinyPng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
}

test("save + info + read: round-trip bytes & metadata per Session", () => {
  const root = freshRoot();
  try {
    const m = createAttachmentManager(root);
    const saved = m.save("ses1", "foto.png", "image/png", tinyPng());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.id).toMatch(/^[0-9a-f-]{36}$/);

    const info = m.info("ses1", saved.data.id);
    expect(info.ok).toBe(true);
    if (info.ok) {
      expect(info.data.filename).toBe("foto.png");
      expect(info.data.mime).toBe("image/png");
      expect(info.data.absPath).toContain(saved.data.id);
      expect(existsSync(info.data.absPath)).toBe(true);
    }
    const read = m.read("ses1", saved.data.id);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect([...read.data.bytes]).toEqual([...tinyPng()]);
      expect(read.data.mime).toBe("image/png");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save menolak mime non-gambar, file kosong, dan file > 20 MiB", () => {
  const root = freshRoot();
  try {
    const m = createAttachmentManager(root);
    expect(m.save("s", "a.txt", "text/plain", new TextEncoder().encode("x")).ok).toBe(false);
    expect(m.save("s", "a.svg", "image/svg+xml", new TextEncoder().encode("<svg/>")).ok).toBe(
      false,
    );
    expect(m.save("s", "a.png", "image/png", new Uint8Array(0)).ok).toBe(false);
    expect(m.save("s", "a.png", "image/png", new Uint8Array(MAX_UPLOAD_BYTES + 1)).ok).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("id tak dikenal / bukan UUID -> info & read gagal tanpa akses path", () => {
  const root = freshRoot();
  try {
    const m = createAttachmentManager(root);
    expect(m.info("ses1", "00000000-0000-0000-0000-000000000000").ok).toBe(false);
    expect(m.read("ses1", "../../etc/passwd").ok).toBe(false); // traversal ditolak
    expect(m.info("ses1", "bukan-uuid").ok).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("info.absPath selalu absolut walau uploadsRoot relatif (agar URL file:// valid untuk opencode)", () => {
  const dir = freshRoot();
  try {
    // uploadsRoot relatif (mis. `data/uploads`) — persis konfigurasi default
    // app yang dulu menghasilkan URL `file://data/…` (host="data") sehingga
    // opencode menolak prompt ("File URL host must be localhost or empty").
    const relRoot = path.relative(process.cwd(), dir);
    expect(path.isAbsolute(relRoot)).toBe(false);
    const m = createAttachmentManager(relRoot);
    const saved = m.save("ses1", "a.png", "image/png", tinyPng());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const info = m.info("ses1", saved.data.id);
    expect(info.ok).toBe(true);
    if (info.ok) {
      expect(path.isAbsolute(info.data.absPath)).toBe(true);
      expect(info.data.absPath.startsWith("/")).toBe(true);
      expect(existsSync(info.data.absPath)).toBe(true);
      // URL file:// yang dibangun dari absPath harus hostless (`file:///…`).
      const url = `file://${info.data.absPath}`;
      expect(url.startsWith("file:///")).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("remove menghapus file & metadata; removeSession menghapus seluruh Session", () => {
  const root = freshRoot();
  try {
    const m = createAttachmentManager(root);
    const s1 = m.save("s1", "a.png", "image/png", tinyPng());
    const s2 = m.save("s2", "b.jpg", "image/jpeg", new Uint8Array([9, 9]));
    expect(s1.ok && s2.ok).toBe(true);
    if (!s1.ok || !s2.ok) return;

    m.remove("s1", s1.data.id);
    expect(m.info("s1", s1.data.id).ok).toBe(false);
    expect(m.info("s2", s2.data.id).ok).toBe(true); // Session lain tidak tersentuh

    m.removeSession("s2");
    expect(m.info("s2", s2.data.id).ok).toBe(false);
    expect(readdirSync(path.join(root, "s1"))).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Session berbeda terisolasi walau nama file sama", () => {
  const root = freshRoot();
  try {
    const m = createAttachmentManager(root);
    const a = m.save("s1", "x.png", "image/png", new Uint8Array([1]));
    const b = m.save("s2", "x.png", "image/png", new Uint8Array([2]));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.data.id).not.toBe(b.data.id);
    const ra = m.read("s1", a.data.id);
    const rb = m.read("s2", b.data.id);
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) expect([...ra.data.bytes]).toEqual([1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
