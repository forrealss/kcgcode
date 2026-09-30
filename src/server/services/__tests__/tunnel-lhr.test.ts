import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore, type SessionStore } from "../../../db";
import { buildSshArgs, createLhrManager, parseLhrLine, type SshProcessLike } from "../tunnel-lhr";

/** Baris JSON asli dari `ssh ... localhost.run -- --output json` (dipangkas). */
const FORWARD_OK = JSON.stringify({
  address: "3b1d872d3c1d63.lhr.life",
  authz_code: "OK",
  connection_id: "1.2.3.4:5",
  event: "tcpip-forward",
  listen_host: "localhost",
  listen_port: 80,
  message:
    "3b1d872d3c1d63.lhr.life tunneled with tls termination, https://3b1d872d3c1d63.lhr.life\nQR…",
});

describe("parseLhrLine", () => {
  test("tcpip-forward OK -> alamat publik", () => {
    expect(parseLhrLine(FORWARD_OK)).toEqual({
      kind: "online",
      address: "3b1d872d3c1d63.lhr.life",
    });
  });

  test("format CloudEvents accepted -> alamat publik", () => {
    const line = JSON.stringify({
      specversion: "1.0",
      id: "localhost/01dafc11bae282.lhr.life",
      type: "v1.tcpip_forward.register.accepted",
      source: "ssh://localhost.run/",
      data: "01dafc11bae282.lhr.life tunneled with tls termination, https://01dafc11bae282.lhr.life\r\nQR…",
    });
    expect(parseLhrLine(line)).toEqual({ kind: "online", address: "01dafc11bae282.lhr.life" });
  });

  test("format CloudEvents: alamat asing / rejected -> denied", () => {
    const evil = JSON.stringify({
      id: "localhost/evil.com",
      type: "v1.tcpip_forward.register.accepted",
      data: "evil.com tunneled",
    });
    expect(parseLhrLine(evil)?.kind).toBe("denied");
    const rejected = JSON.stringify({
      id: "x",
      type: "v1.tcpip_forward.register.rejected",
      data: "no capacity\r\nmore",
    });
    expect(parseLhrLine(rejected)).toEqual({ kind: "denied", message: "no capacity" });
  });

  test("header non-JSON & JSON rusak diabaikan", () => {
    expect(parseLhrLine("tunnel config: inject-http-proxy-headers=false")).toBeNull();
    expect(parseLhrLine("{not json")).toBeNull();
  });

  test("event lain -> pesan baris pertama saja", () => {
    const line = JSON.stringify({ event: "authn", message: "authenticated as anonymous user\nx" });
    expect(parseLhrLine(line)).toEqual({
      kind: "info",
      message: "authenticated as anonymous user",
    });
  });

  test("alamat di luar domain localhost.run ditolak (anti suntik URL)", () => {
    for (const address of ["evil.com", "a.lhr.life.evil.com", "javascript:alert(1)", ""]) {
      const line = JSON.stringify({ event: "tcpip-forward", authz_code: "OK", address });
      expect(parseLhrLine(line)?.kind).toBe("denied");
    }
  });

  test("authz bukan OK -> denied", () => {
    const line = JSON.stringify({
      event: "tcpip-forward",
      authz_code: "DENIED",
      address: "x.lhr.life",
      message: "nope",
    });
    expect(parseLhrLine(line)).toEqual({ kind: "denied", message: "nope" });
  });
});

describe("buildSshArgs", () => {
  test("forward ke host:port lokal + JSON output + keepalive", () => {
    const args = buildSshArgs({ localIp: "127.0.0.1", localPort: 3000, knownHosts: "/d/kh" });
    expect(args).toContain("80:127.0.0.1:3000");
    expect(args).toContain("nokey@localhost.run");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("UserKnownHostsFile=/d/kh");
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args.slice(-3)).toEqual(["--", "--output", "json"]);
  });
});

// ---------------------------------------------------------------------------

function fakeSsh() {
  let push: (s: string) => void = () => {};
  let close: () => void = () => {};
  let exit: (code: number) => void = () => {};
  const stdout = new ReadableStream<Uint8Array>({
    start(c) {
      push = (s) => c.enqueue(new TextEncoder().encode(`${s}\n`));
      close = () => c.close();
    },
  });
  const exited = new Promise<number | null>((res) => {
    exit = (code) => {
      close();
      res(code);
    };
  });
  const proc: SshProcessLike = {
    pid: 7,
    exited,
    stdout,
    stderr: new ReadableStream({ start: (c) => c.close() }),
    kill: () => exit(0),
  };
  return { proc, push, exit };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

function harness(opts: { protectedApp?: boolean; hasSsh?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-lhr-"));
  const store: SessionStore = openSessionStore(":memory:");
  const protectedApp = { v: opts.protectedApp ?? true };
  const spawned: { args: string[]; ssh: ReturnType<typeof fakeSsh> }[] = [];
  const mgr = createLhrManager({
    store,
    localPort: 3000,
    localHost: "0.0.0.0",
    dataDir: dir,
    isProtected: () => protectedApp.v,
    hasSsh: () => opts.hasSsh ?? true,
    backoff: () => 5,
    spawn: (args) => {
      const ssh = fakeSsh();
      spawned.push({ args, ssh });
      return ssh.proc;
    },
  });
  cleanup.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, mgr, spawned, protectedApp };
}

const tick = () => Bun.sleep(5);

describe("createLhrManager", () => {
  test("start -> online dengan alamat dari event JSON", async () => {
    const h = harness();
    const r = await h.mgr.start();
    expect(r.ok).toBe(true);
    expect(h.mgr.status().phase).toBe("connecting");
    // wildcard bind -> loopback
    expect(h.spawned[0]?.args).toContain("80:127.0.0.1:3000");

    h.spawned[0]?.ssh.push(FORWARD_OK);
    await tick();
    expect(h.mgr.status()).toMatchObject({
      phase: "online",
      url: "https://3b1d872d3c1d63.lhr.life",
      enabled: true,
    });
  });

  test("wajib app lock", async () => {
    const h = harness({ protectedApp: false });
    const r = await h.mgr.start();
    expect(r).toEqual({ ok: false, error: "TUNNEL_LOCK_REQUIRED" });
    expect(h.spawned).toHaveLength(0);
  });

  test("tanpa ssh -> LHR_SSH_MISSING", async () => {
    const h = harness({ hasSsh: false });
    const r = await h.mgr.start();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("LHR_SSH_MISSING");
  });

  test("stop mematikan proses & menghapus alamat", async () => {
    const h = harness();
    await h.mgr.start();
    h.spawned[0]?.ssh.push(FORWARD_OK);
    await tick();
    const s = await h.mgr.stop();
    expect(s).toMatchObject({ phase: "stopped", url: null, enabled: false });
  });

  test("koneksi putus -> sambung ulang otomatis (alamat baru)", async () => {
    const h = harness();
    await h.mgr.start();
    h.spawned[0]?.ssh.push(FORWARD_OK);
    await tick();
    h.spawned[0]?.ssh.exit(255);
    await tick();
    expect(h.mgr.status().url).toBeNull();
    await Bun.sleep(30);
    expect(h.spawned).toHaveLength(2);
    h.spawned[1]?.ssh.push(FORWARD_OK.replace(/3b1d872d3c1d63/g, "ffff0000"));
    await tick();
    expect(h.mgr.status().url).toBe("https://ffff0000.lhr.life");
  });

  test("kunci dihapus -> tunnel dimatikan", async () => {
    const h = harness();
    await h.mgr.start();
    h.protectedApp.v = false;
    h.mgr.handleLockChanged(false);
    await Bun.sleep(20);
    expect(h.mgr.status()).toMatchObject({ phase: "stopped", error: "TUNNEL_LOCK_REQUIRED" });
  });

  test("autoStart hanya bila sebelumnya dinyalakan", async () => {
    const h = harness();
    h.mgr.autoStart();
    await tick();
    expect(h.spawned).toHaveLength(0);
    h.store.setLhrEnabled(true, Date.now());
    h.mgr.autoStart();
    await tick();
    expect(h.spawned).toHaveLength(1);
  });
});
