/**
 * Property & unit test `project-manager.ts` (task 8.2, 8.3).
 * - Property 29: Pembuatan Project unik berhasil round-trip (10.4)
 * - Property 30: Nama/path Project duplikat selalu ditolak (10.5, 10.6)
 * - Unit 8.3: edge case path & nama (10.3, 10.7)
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { openSessionStore } from "./db";
import { createProjectManager } from "./project-manager";

let root: string;

const SAFE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_-";

function safeNameArb() {
  return fc
    .array(fc.constantFrom(...SAFE_CHARS.split("")), { minLength: 1, maxLength: 12 })
    .map((segs) => segs.join(""));
}

function safePathArb() {
  return fc
    .array(
      fc
        .array(fc.constantFrom(...SAFE_CHARS.split("")), { minLength: 1, maxLength: 8 })
        .map((segs) => segs.join("")),
      { minLength: 1, maxLength: 3 },
    )
    .map((segs) => segs.join("/"));
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "kcg-proj-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Store fresh per-run agar nama/path antar-run tidak konflik. */
function freshManager() {
  const store = openSessionStore(":memory:");
  return { store, pm: createProjectManager(root, store) };
}

// Feature: kcg-bridge, Property 29: Pembuatan Project unik berhasil round-trip
test("Property 29: createProject sukses -> direktori ada & listProjects menyertakannya", () => {
  fc.assert(
    fc.property(safeNameArb(), safePathArb(), (name, relPath) => {
      const { store, pm } = freshManager();
      try {
        const res = pm.createProject(name, relPath);
        expect(res.ok).toBe(true);
        if (res.ok) {
          // Direktori dibuat bila belum ada (Requirement 10.4)
          expect(existsSync(res.data.path)).toBe(true);
          // Round-trip: listProjects menyertakan Project baru
          const listed = pm.listProjects();
          expect(listed.some((p) => p.id === res.data.id && p.name === name)).toBe(true);
          // Store menyimpan nama & path yang sama
          expect(res.data.path.startsWith(path.resolve(root))).toBe(true);
        }
      } finally {
        store.close();
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 30: Nama atau path Project duplikat selalu ditolak
test("Property 30: nama duplikat -> NAME_TAKEN; path duplikat -> PATH_TAKEN", () => {
  fc.assert(
    fc.property(safeNameArb(), safePathArb(), (name, relPath) => {
      const { store, pm } = freshManager();
      try {
        const first = pm.createProject(name, relPath);
        expect(first.ok).toBe(true);
        const before = pm.listProjects().length;

        // Nama sama, path berbeda
        const dupName = pm.createProject(name, `${relPath}-x`);
        expect(dupName.ok).toBe(false);
        if (!dupName.ok) expect(dupName.error).toBe("NAME_TAKEN");

        // Path sama, nama berbeda
        const dupPath = pm.createProject(`${name}-x`, relPath);
        expect(dupPath.ok).toBe(false);
        if (!dupPath.ok) expect(dupPath.error).toBe("PATH_TAKEN");

        // Tidak menambah baris projects baru
        expect(pm.listProjects().length).toBe(before);
      } finally {
        store.close();
      }
    }),
    { numRuns: 100 },
  );
});

// ---- Task 8.3: unit test edge case path & nama ----
test("8.3: path mengandung ../etc ditolak", () => {
  const { pm } = freshManager();
  const res = pm.createProject("proj", "../etc");
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe("PATH_OUTSIDE_SANDBOX");
});

test("8.3: path absolut di luar sandbox ditolak", () => {
  const { pm } = freshManager();
  const res = pm.createProject("proj", "/etc");
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe("PATH_OUTSIDE_SANDBOX");
});

test("8.3: nama direktori dengan karakter unicode diterima", () => {
  const { store, pm } = freshManager();
  const res = pm.createProject("proj-unicode", "proyék-✓/sub");
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(existsSync(res.data.path)).toBe(true);
    expect(res.data.path).toContain("proyék-✓");
  }
  store.close();
});

test("8.3: nama/path dengan karakter terlarang OS ditolak", () => {
  const { pm } = freshManager();
  const res = pm.createProject("proj", `bad\0dir`);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe("INVALID_PATH_CHARS");
});

test("8.3: listDirectory path tidak ditemukan -> PATH_NOT_FOUND", () => {
  const { pm } = freshManager();
  const res = pm.listDirectory("tidak-ada");
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe("PATH_NOT_FOUND");
});

test("8.3: listDirectory hanya mengembalikan direktori (bukan file)", () => {
  const { pm } = freshManager();
  const sub = mkdtempSync(path.join(root, "listtest-"));
  mkdirSync(path.join(sub, "dir1"));
  writeFileSync(path.join(sub, "file.txt"), "x");
  const rel = path.relative(root, sub);
  const res = pm.listDirectory(rel);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.data.entries).toEqual(["dir1"]);
  }
});
