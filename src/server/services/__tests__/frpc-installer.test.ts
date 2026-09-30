import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createFrpcInstaller, FRP_VERSION } from "../frpc-installer";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Build a real frp-shaped .tar.gz with a fake frpc script inside. */
async function fakeRelease(): Promise<{ bytes: ArrayBuffer; sha256: string }> {
  const src = mkdtempSync(path.join(tmpdir(), "kcg-frp-src-"));
  dirs.push(src);
  const name = `frp_${FRP_VERSION}_linux_amd64`;
  mkdirSync(path.join(src, name));
  await Bun.write(path.join(src, name, "frpc"), "#!/bin/sh\necho fake\n");
  const archive = path.join(src, `${name}.tar.gz`);
  const proc = Bun.spawn(["tar", "-czf", archive, "-C", src, name]);
  expect(await proc.exited).toBe(0);
  const bytes = await Bun.file(archive).arrayBuffer();
  return { bytes, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
}

describe("frpc installer", () => {
  test("rejects an archive whose checksum does not match the pinned one", async () => {
    const { bytes } = await fakeRelease();
    const binDir = mkdtempSync(path.join(tmpdir(), "kcg-frpc-test-"));
    dirs.push(binDir);
    const installer = createFrpcInstaller({
      binDir,
      platform: "linux",
      arch: "x64",
      which: () => null,
      fetch: (async () => new Response(bytes)) as unknown as typeof fetch,
    });

    const r = await installer.ensure();
    expect(r).toEqual({ ok: false, error: "FRPC_CHECKSUM_MISMATCH" });
    expect(existsSync(path.join(binDir, "frpc"))).toBe(false);
  });

  test("installs across filesystems (tmpdir -> home) without EXDEV, atomically", async () => {
    const { bytes, sha256 } = await fakeRelease();
    // binDir under $HOME while extraction happens in tmpdir(): on many systems
    // /tmp is tmpfs, so a plain rename() would fail with EXDEV.
    const binDir = mkdtempSync(path.join(homedir(), ".kcg-frpc-test-"));
    dirs.push(binDir);
    const installer = createFrpcInstaller({
      binDir,
      platform: "linux",
      arch: "x64",
      which: () => null,
      fetch: (async () => new Response(bytes)) as unknown as typeof fetch,
      sha256Override: sha256,
    });

    const r = await installer.ensure();
    expect(r.ok).toBe(true);
    const target = path.join(binDir, "frpc");
    expect(r.ok && r.data).toBe(target);
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(readdirSync(binDir)).toEqual(["frpc"]);
  });

  test("prefers an existing binary and does not download", async () => {
    const binDir = mkdtempSync(path.join(tmpdir(), "kcg-frpc-test-"));
    dirs.push(binDir);
    let fetched = false;
    const installer = createFrpcInstaller({
      binDir,
      which: () => "/usr/local/bin/frpc",
      fetch: (async () => {
        fetched = true;
        return new Response("");
      }) as unknown as typeof fetch,
    });
    expect(await installer.ensure()).toEqual({ ok: true, data: "/usr/local/bin/frpc" });
    expect(fetched).toBe(false);
  });
});
