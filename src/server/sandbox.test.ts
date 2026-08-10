/**
 * Property test `sandbox.ts` (task 7.2).
 * - Property 27: Folder_Browser mengembalikan persis sub-direktori (10.2)
 * - Property 28: Path di luar Sandbox_Root selalu ditolak (10.3, 10.7)
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { openSessionStore } from "./db";
import { createProjectManager } from "./project-manager";
import { resolveWithinSandbox } from "./sandbox";

let root: string;
let outsideDir: string;
let store: ReturnType<typeof openSessionStore>;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "kcg-sandbox-"));
  outsideDir = mkdtempSync(path.join(tmpdir(), "kcg-outside-"));
  mkdirSync(path.join(root, "a", "a1"), { recursive: true });
  mkdirSync(path.join(root, "a", "a2"), { recursive: true });
  mkdirSync(path.join(root, "b", "b1"), { recursive: true });
  mkdirSync(path.join(root, "b", "b2"), { recursive: true });
  writeFileSync(path.join(root, "a", "file.txt"), "x");
  writeFileSync(path.join(root, "top.txt"), "x");
  // Symlink yang mengarah keluar sandbox (harus ditolak).
  symlinkSync(outsideDir, path.join(root, "evil-link"));
  store = openSessionStore(":memory:");
});

afterAll(() => {
  store?.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

// Feature: kcg-bridge, Property 27: Folder_Browser mengembalikan persis sub-direktori dalam sandbox
test("Property 27: listDirectory mengembalikan persis sub-direktori untuk sub-path valid", () => {
  const pm = createProjectManager(root, store);
  const validPaths = ["", "a", "a/a1", "a/a2", "b", "b/b1", "b/b2"];
  const expected = new Map<string, string[]>([
    ["", ["a", "b"]],
    ["a", ["a1", "a2"]],
    ["a/a1", []],
    ["a/a2", []],
    ["b", ["b1", "b2"]],
    ["b/b1", []],
    ["b/b2", []],
  ]);

  fc.assert(
    fc.property(fc.constantFrom(...validPaths), (p) => {
      const res = pm.listDirectory(p);
      expect(res.ok).toBe(true);
      if (res.ok) {
        // Tepat himpunan sub-direktori: tidak ada yang hilang, tidak ada tambahan
        expect(res.data.entries).toEqual(expected.get(p) ?? []);
        // Tidak ada file, tidak ada entri dari luar sandbox
        for (const entry of res.data.entries) {
          expect(entry).not.toBe("file.txt");
          expect(entry).not.toBe("top.txt");
          expect(entry).not.toBe("evil-link");
        }
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 28: Path di luar Sandbox_Root selalu ditolak
test("Property 28: path dengan '..' selalu ditolak sebagai outside_sandbox", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("a", "b", "c")).map((segs) => [...segs, "..", ...segs]),
      (segs) => {
        const p = segs.join("/");
        const res = resolveWithinSandbox(root, p);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe("outside_sandbox");
      },
    ),
    { numRuns: 100 },
  );
});

test("Property 28: path absolut di luar sandbox selalu ditolak", () => {
  fc.assert(
    fc.property(fc.constantFrom("/etc", "/tmp", "/usr", "/home"), (p) => {
      const res = resolveWithinSandbox(root, p);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("outside_sandbox");
    }),
    { numRuns: 100 },
  );
});

test("Property 28: symlink ke luar sandbox selalu ditolak", () => {
  fc.assert(
    fc.property(fc.constantFrom("evil-link", "evil-link/child", "evil-link/../.."), (p) => {
      const res = resolveWithinSandbox(root, p);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("outside_sandbox");
    }),
    { numRuns: 100 },
  );
});

test("Property 28: karakter terlarang OS -> invalid_chars", () => {
  const forbiddenSeg = fc.array(fc.constantFrom("a", "b", "\0")).map((segs) => segs.join(""));
  fc.assert(
    fc.property(
      fc
        .array(forbiddenSeg, { minLength: 1, maxLength: 5 })
        .filter((segs) => segs.some((s) => s.includes("\0"))),
      (segs) => {
        const res = resolveWithinSandbox(root, segs.join("/"));
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe("invalid_chars");
      },
    ),
    { numRuns: 100 },
  );
});

test("Property 28: listDirectory & createProject menolak path luar sandbox tanpa efek filesystem", () => {
  const pm = createProjectManager(root, store);

  const listRes = pm.listDirectory("../etc");
  expect(listRes.ok).toBe(false);
  if (!listRes.ok) expect(listRes.error).toBe("PATH_OUTSIDE_SANDBOX");

  const createRes = pm.createProject("evils", "/etc/escape");
  expect(createRes.ok).toBe(false);
  if (!createRes.ok) expect(createRes.error).toBe("PATH_OUTSIDE_SANDBOX");

  // Tidak ada direktori baru dibuat di luar sandbox
  const outsideProbe = path.join(outsideDir, "escape");
  expect(existsSync(outsideProbe)).toBe(false);
});
