import { describe, expect, test } from "bun:test";
import {
  attachmentKind,
  fileExtension,
  formatBytes,
  modelFacingMime,
  normalizeMime,
} from "../attachments";

describe("attachmentKind", () => {
  test("gambar umum & PDF dikenali dari mime", () => {
    expect(attachmentKind("image/png", "a.png")).toBe("image");
    expect(attachmentKind("image/webp", "a.webp")).toBe("image");
    expect(attachmentKind("application/pdf", "doc.pdf")).toBe("pdf");
  });

  test("file kode dikenali dari ekstensi walau mime salah / kosong", () => {
    expect(attachmentKind("video/mp2t", "main.ts")).toBe("text");
    expect(attachmentKind("", "lib.rs")).toBe("text");
    expect(attachmentKind("", "Dockerfile")).toBe("text");
    expect(attachmentKind("application/json", "data")).toBe("text");
    expect(attachmentKind("text/csv", "x.csv")).toBe("text");
  });

  test("SVG diperlakukan teks, bukan gambar pratinjau", () => {
    expect(attachmentKind("image/svg+xml", "logo.svg")).toBe("text");
  });

  test("lainnya biner", () => {
    expect(attachmentKind("application/zip", "a.zip")).toBe("binary");
    expect(attachmentKind("image/heic", "p.heic")).toBe("binary");
    expect(attachmentKind("", "blob")).toBe("binary");
  });
});

describe("modelFacingMime", () => {
  test("teks dikirim sebagai text/plain, biner tidak dikirim", () => {
    expect(modelFacingMime("text/csv", "x.csv")).toBe("text/plain");
    expect(modelFacingMime("image/png", "a.png")).toBe("image/png");
    expect(modelFacingMime("application/pdf", "a.pdf")).toBe("application/pdf");
    expect(modelFacingMime("application/zip", "a.zip")).toBeNull();
  });
});

test("normalizeMime menolak nilai yang bisa menyuntik header", () => {
  expect(normalizeMime("Text/Plain")).toBe("text/plain");
  expect(normalizeMime("")).toBe("application/octet-stream");
  expect(normalizeMime("text/html\r\nx-evil: 1")).toBe("application/octet-stream");
  expect(normalizeMime("text/plain; charset=utf-8")).toBe("application/octet-stream");
});

test("fileExtension & formatBytes", () => {
  expect(fileExtension("a/b/c.TAR.GZ")).toBe("gz");
  expect(fileExtension(".env")).toBe("");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
});
