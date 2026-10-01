/**
 * Unit test `git-info.ts` — dijalankan pada repo git SUNGGUHAN di tmpdir
 * (bukan mock `Bun.spawn`), karena yang rawan salah justru penafsiran output
 * git: urutan `--left-right` pada `rev-list` mudah tertukar antara
 * ahead & behind.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readGitInfo } from "../git-info";

async function run(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  await proc.exited;
}

async function commit(cwd: string, name: string): Promise<void> {
  writeFileSync(path.join(cwd, name), name);
  await run(cwd, ["git", "add", "."]);
  await run(cwd, ["git", "commit", "-m", name]);
}

test("cabang, ahead/behind, dan remote dibaca dari repo sungguhan", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kcg-git-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  try {
    await run(root, ["git", "init", "--bare", "-b", "main", remote]);
    await run(root, ["git", "clone", remote, work]);
    await run(work, ["git", "config", "user.email", "t@example.com"]);
    await run(work, ["git", "config", "user.name", "Tester"]);
    await commit(work, "a.txt");
    await run(work, ["git", "push", "-u", "origin", "main"]);

    const synced = await readGitInfo(work);
    expect(synced.branch).toBe("main");
    expect(synced.hasRemote).toBe(true);
    expect(synced.ahead).toBe(0);
    expect(synced.behind).toBe(0);

    // Dua commit lokal yang belum dipush = ahead 2 (BUKAN behind).
    await commit(work, "b.txt");
    await commit(work, "c.txt");
    const ahead = await readGitInfo(work);
    expect(ahead.ahead).toBe(2);
    expect(ahead.behind).toBe(0);

    // Cabang baru tanpa upstream -> selisih tidak diketahui, bukan 0.
    await run(work, ["git", "checkout", "-b", "feature"]);
    const noUpstream = await readGitInfo(work);
    expect(noUpstream.branch).toBe("feature");
    expect(noUpstream.ahead).toBeNull();
    expect(noUpstream.behind).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direktori biasa (bukan repo git) -> info kosong, bukan error", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-nogit-"));
  try {
    const info = await readGitInfo(dir);
    expect(info).toEqual({ branch: null, ahead: null, behind: null, hasRemote: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("path yang tidak ada -> info kosong (tidak melempar)", async () => {
  const info = await readGitInfo("/tmp/kcg-does-not-exist-xyz");
  expect(info.branch).toBeNull();
  expect(info.hasRemote).toBe(false);
});
