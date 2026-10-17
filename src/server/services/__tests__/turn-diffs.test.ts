/**
 * Perubahan file per turn (snapshot git dengan index sementara) dan viewer
 * file Project (batas keamanan path).
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readProjectFile, readProjectImage, resolveProjectFile } from "../project-files";
import { createTurnDiffs, snapshotTree } from "../turn-diffs";

const tmp = mkdtempSync(path.join(tmpdir(), "kcg-turndiff-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function git(cwd: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out;
}

async function makeRepo(name: string): Promise<string> {
  const repo = path.join(tmp, name);
  mkdirSync(path.join(repo, "app"), { recursive: true });
  await git(repo, "init", "-q");
  await git(repo, "config", "user.email", "t@t");
  await git(repo, "config", "user.name", "t");
  writeFileSync(path.join(repo, ".gitignore"), "node_modules\n");
  writeFileSync(path.join(repo, "app", "a.txt"), "a\n");
  writeFileSync(path.join(repo, "app", "old.txt"), "same content\nline 2\nline 3\n");
  writeFileSync(path.join(repo, "outside.txt"), "x\n");
  await git(repo, "add", "-A");
  await git(repo, "commit", "-qm", "init");
  return repo;
}

describe("turn diffs", () => {
  test("captures the project's changes without touching the user's index", async () => {
    const repo = await makeRepo("r1");
    const cwd = path.join(repo, "app");
    writeFileSync(path.join(repo, "staged.txt"), "s\n");
    await git(repo, "add", "staged.txt");
    const statusBefore = await git(repo, "status", "--porcelain");

    const got: string[] = [];
    const t = createTurnDiffs({ dir: path.join(tmp, "store1"), onDiff: (d) => got.push(d.id) });
    t.turnStarted("s1", cwd);
    t.noteMessage("s1", "msg_first");
    t.noteMessage("s1", "msg_second");
    await Bun.sleep(200);

    appendFileSync(path.join(cwd, "a.txt"), "b\nc\n");
    writeFileSync(path.join(cwd, "new.ts"), "export const x = 1;\n");
    renameSync(path.join(cwd, "old.txt"), path.join(cwd, "renamed.txt"));
    mkdirSync(path.join(cwd, "node_modules"), { recursive: true });
    writeFileSync(path.join(cwd, "node_modules", "junk.js"), "x");
    writeFileSync(path.join(repo, "outside.txt"), "changed outside the project\n");

    const diff = await t.turnEnded("s1");
    expect(diff?.messageId).toBe("msg_first");
    expect(got).toEqual([diff?.id ?? ""]);
    expect(diff?.files).toEqual([
      { path: "a.txt", status: "modified", additions: 2, deletions: 0 },
      { path: "new.ts", status: "added", additions: 1, deletions: 0 },
      { path: "renamed.txt", oldPath: "old.txt", status: "renamed", additions: 0, deletions: 0 },
    ]);

    const fd = await t.fileDiff("s1", diff?.id ?? "", "a.txt");
    expect(fd.ok && fd.data).toContain("+b\n+c");
    expect((await t.fileDiff("s1", diff?.id ?? "", "../outside.txt")).ok).toBe(false);

    // Index & status pengguna tidak berubah selain karena edit di working tree.
    const statusAfter = await git(repo, "status", "--porcelain");
    expect(statusAfter).toContain("A  staged.txt");
    expect(statusBefore.split("\n").filter(Boolean)).toEqual(["A  staged.txt"]);
    expect(statusAfter).toContain("?? app/new.ts");

    // Tersimpan & bisa dibaca setelah restart.
    expect(
      createTurnDiffs({ dir: path.join(tmp, "store1") })
        .list("s1")
        .map((d) => d.id),
    ).toEqual([diff?.id ?? ""]);
    t.removeSession("s1");
    expect(createTurnDiffs({ dir: path.join(tmp, "store1") }).list("s1")).toEqual([]);
  });

  test("no changes, or not a git repo -> nothing recorded", async () => {
    const repo = await makeRepo("r2");
    const t = createTurnDiffs({ dir: path.join(tmp, "store2") });
    t.turnStarted("s", path.join(repo, "app"));
    expect(await t.turnEnded("s")).toBeNull();

    const plain = path.join(tmp, "plain");
    mkdirSync(plain, { recursive: true });
    expect(await snapshotTree(plain)).toBeNull();
    t.turnStarted("s", plain);
    writeFileSync(path.join(plain, "x.txt"), "x");
    expect(await t.turnEnded("s")).toBeNull();
    expect(await t.turnEnded("never-started")).toBeNull();
  });
});

describe("project files", () => {
  const root = path.join(tmp, "proj");
  const secret = path.join(tmp, "data");
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, ".git"), { recursive: true });
  mkdirSync(secret, { recursive: true });
  writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(root, ".git", "config"), "[core]\n");
  writeFileSync(path.join(root, "logo.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(root, "blob.bin"), new Uint8Array([1, 0, 2, 0]));
  writeFileSync(path.join(root, "big.txt"), "x".repeat(600 * 1024));
  writeFileSync(path.join(secret, "kcg.sqlite"), "secret");
  symlinkSync(path.join(secret, "kcg.sqlite"), path.join(root, "link-out"));
  writeFileSync(path.join(tmp, "sibling.txt"), "nope");

  test("reads text, images and binaries inside the project", () => {
    expect(readProjectFile(root, "src/a.ts", [])).toEqual({
      ok: true,
      data: {
        path: "src/a.ts",
        size: 20,
        kind: "text",
        content: "export const a = 1;\n",
        truncated: false,
      },
    });
    expect(
      readProjectFile(root, "logo.png", []).ok && readProjectFile(root, "logo.png", []),
    ).toMatchObject({
      data: { kind: "image", content: null },
    });
    expect(readProjectFile(root, "blob.bin", [])).toMatchObject({
      ok: true,
      data: { kind: "binary" },
    });
    const big = readProjectFile(root, "big.txt", []);
    expect(big.ok && big.data.truncated).toBe(true);
    expect(big.ok && big.data.content?.length).toBe(512 * 1024);
    const img = readProjectImage(root, "logo.png", []);
    expect(img.ok && img.data.mime).toBe("image/png");
    expect(readProjectImage(root, "src/a.ts", [])).toEqual({
      ok: false,
      error: "UNSUPPORTED_TYPE",
    });
  });

  test("refuses paths outside the project, .git, symlinks out, and protected dirs", () => {
    for (const p of [
      "../sibling.txt",
      "/etc/passwd",
      ".git/config",
      "link-out",
      "missing.ts",
      "src",
    ]) {
      expect({ p, ok: resolveProjectFile(root, p, [secret]).ok }).toEqual({ p, ok: false });
    }
    // Folder data kcgcode di dalam Project tetap terlarang.
    mkdirSync(path.join(root, "kcgdata"), { recursive: true });
    writeFileSync(path.join(root, "kcgdata", "db"), "x");
    expect(resolveProjectFile(root, "kcgdata/db", [path.join(root, "kcgdata")]).ok).toBe(false);
    // File config persis (bukan foldernya) — Project di folder yang sama tetap terbaca.
    writeFileSync(path.join(root, "config.json"), "{}");
    expect(resolveProjectFile(root, "config.json", [path.join(root, "config.json")]).ok).toBe(
      false,
    );
    expect(resolveProjectFile(root, "src/a.ts", [path.join(root, "config.json")]).ok).toBe(true);
  });
});
