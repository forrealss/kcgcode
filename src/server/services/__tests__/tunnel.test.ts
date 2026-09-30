import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore, type SessionStore } from "../../../db";
import { frpAssetFor } from "../frpc-installer";
import {
  buildFrpcConfig,
  classifyFrpcLine,
  createTunnelManager,
  type FrpcProcessLike,
  frpcLocalIp,
  parseFrpServer,
} from "../tunnel";
import type { PollResult, TunnelApi } from "../tunnel-api";

const VPS_TOML = `serverAddr = "frp.example.com"
serverPort = 7000
user = "demo"
metadatas.token = "old"

[[proxies]]
name = "demo"
type = "http"
localPort = 3000
subdomain = "demo"
`;

/** Proses frpc palsu: tulis baris ke stdout, keluar saat diminta. */
function fakeProc() {
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
  const proc: FrpcProcessLike = {
    pid: 42,
    exited,
    stdout,
    stderr: new ReadableStream({ start: (c) => c.close() }),
    kill: () => exit(0),
  };
  return { proc, push, exit };
}

interface Harness {
  store: SessionStore;
  dir: string;
  protectedApp: { v: boolean };
  api: TunnelApi & { calls: string[]; polls: PollResult[]; revoked: { v: boolean } };
  procs: ReturnType<typeof fakeProc>[];
  manager: ReturnType<typeof createTunnelManager>;
}

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const GRANT: PollResult = {
  state: "granted",
  grant: {
    deviceToken: "dev-token-1",
    deviceId: "dev-1",
    email: "a@b.c",
    username: "demo",
    subdomain: "demo.example.com",
    tunnelSecret: "secret-1",
  },
};

function harness(): Harness {
  const store = openSessionStore(":memory:");
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-tunnel-"));
  dirs.push(dir);
  const protectedApp = { v: true };
  const calls: string[] = [];
  const polls: PollResult[] = [];
  const revoked = { v: false };
  const api: Harness["api"] = {
    calls,
    polls,
    revoked,
    async startDevice(name, port) {
      calls.push(`start:${name}:${port}`);
      return {
        ok: true,
        data: {
          deviceCode: "dc",
          userCode: "BCDF-GHJK",
          verificationUri: "https://kcgcode.example.com/device",
          verificationUriComplete: "https://kcgcode.example.com/device?code=BCDF-GHJK",
          expiresIn: 600,
          interval: 5,
        },
      };
    },
    async pollDevice() {
      calls.push("poll");
      return { ok: true, data: polls.shift() ?? { state: "pending" } };
    },
    async fetchConfig(token, port) {
      calls.push(`config:${token}:${port}`);
      if (revoked.v) return { ok: false, error: "TUNNEL_DEVICE_REVOKED" };
      return { ok: true, data: VPS_TOML };
    },
    async rotateSecret() {
      calls.push("rotate");
      return { ok: true, data: "secret-2" };
    },
    async revokeSelf(token) {
      calls.push(`revoke:${token}`);
      return { ok: true, data: null };
    },
  };
  const procs: ReturnType<typeof fakeProc>[] = [];
  const manager = createTunnelManager({
    store,
    config: { apiUrl: "http://vps.test" },
    api,
    installer: { ensure: async () => ({ ok: true, data: "/bin/frpc" }) },
    localPort: 3000,
    localHost: "127.0.0.1",
    configPath: path.join(dir, "frpc.toml"),
    isProtected: () => protectedApp.v,
    deviceName: "test-box",
    spawn: () => {
      const p = fakeProc();
      procs.push(p);
      return p.proc;
    },
    backoff: () => 10,
    sleep: () => Bun.sleep(1),
  });
  return { store, dir, protectedApp, api, procs, manager };
}

/** Pairing sampai disetujui (tunnel langsung start bila kunci ada). */
async function pair(h: Harness): Promise<void> {
  h.api.polls.push({ state: "pending" }, GRANT);
  expect((await h.manager.connect()).ok).toBe(true);
  await Bun.sleep(30);
}

describe("helper murni", () => {
  test("parseFrpServer mengambil host+port dan menolak nilai aneh", () => {
    expect(parseFrpServer(VPS_TOML)).toEqual({ addr: "frp.example.com", port: 7000 });
    expect(parseFrpServer('serverAddr = "evil host;rm"\n')).toBeNull();
    expect(parseFrpServer('serverAddr = "a.b"\nserverPort = 99999\n')).toBeNull();
  });

  test("buildFrpcConfig hanya satu proxy http milik user", () => {
    const toml = buildFrpcConfig({
      serverAddr: "frp.example.com",
      serverPort: 7000,
      username: "demo",
      tunnelSecret: "s",
      localIp: "127.0.0.1",
      localPort: 4000,
    });
    expect(toml.match(/\[\[proxies\]\]/g)?.length).toBe(1);
    expect(toml).toContain('type = "http"');
    expect(toml).toContain("localPort = 4000");
    expect(toml).toContain('subdomain = "demo"');
    expect(toml).toContain("loginFailExit = true");
  });

  test("frpcLocalIp memetakan bind wildcard ke loopback", () => {
    expect(frpcLocalIp("0.0.0.0")).toBe("127.0.0.1");
    expect(frpcLocalIp("::")).toBe("127.0.0.1");
    expect(frpcLocalIp("192.168.1.5")).toBe("192.168.1.5");
    expect(frpcLocalIp("host; rm -rf")).toBe("127.0.0.1");
  });

  test("classifyFrpcLine", () => {
    expect(classifyFrpcLine("[demo] start proxy success")).toBe("online");
    expect(classifyFrpcLine("login to server success, get run id")).toBe("logged_in");
    expect(classifyFrpcLine("login to the server failed: authorization failed")).toBe(
      "auth_failed",
    );
    expect(classifyFrpcLine("[demo] start error: subdomain [demo] is already used")).toBe(
      "proxy_failed",
    );
    expect(classifyFrpcLine("try to reconnect to server...")).toBe("reconnecting");
  });

  test("aset frp terpin", () => {
    expect(frpAssetFor("linux", "x64")?.sha256).toHaveLength(64);
    expect(frpAssetFor("sunos", "x64")).toBeNull();
  });
});

describe("Tunnel_Manager", () => {
  test("without a tunnel API URL: status says not configured and connect is refused", async () => {
    const store = openSessionStore(":memory:");
    const m = createTunnelManager({
      store,
      config: { apiUrl: null },
      api: {} as unknown as TunnelApi,
      installer: { ensure: async () => ({ ok: false, error: "x" }) },
      localPort: 3000,
      localHost: "127.0.0.1",
      configPath: "/nonexistent/frpc.toml",
      isProtected: () => true,
    });
    expect(m.status().configured).toBe(false);
    expect(await m.connect()).toEqual({ ok: false, error: "TUNNEL_NOT_CONFIGURED" });
  });

  test("device flow: connect -> pending -> granted, lalu tunnel menyala", async () => {
    const h = harness();
    h.api.polls.push({ state: "pending" }, { state: "slow_down" }, GRANT);
    const r = await h.manager.connect();
    expect(r.ok).toBe(true);
    const s0 = h.manager.status();
    expect(s0.phase).toBe("signed_out");
    expect(s0.pairing?.userCode).toBe("BCDF-GHJK");
    expect(h.api.calls[0]).toBe("start:test-box:3000");

    await Bun.sleep(40);
    const s = h.manager.status();
    expect(s.pairing).toBeNull();
    expect(s.account?.url).toBe("https://demo.example.com");
    expect(s.enabled).toBe(true);
    expect(h.procs).toHaveLength(1);
    // Token & secret tidak pernah muncul di status yang dikirim ke browser.
    expect(JSON.stringify(s)).not.toContain("secret-1");
    expect(JSON.stringify(s)).not.toContain("dev-token-1");
  });

  test("tanpa app lock: tersambung tapi tidak otomatis start; start ditolak", async () => {
    const h = harness();
    h.protectedApp.v = false;
    await pair(h);
    expect(h.manager.status().account).not.toBeNull();
    expect(h.procs).toHaveLength(0);
    expect(await h.manager.start()).toEqual({ ok: false, error: "TUNNEL_LOCK_REQUIRED" });
  });

  test("ditolak / kedaluwarsa / dibatalkan", async () => {
    const h = harness();
    h.api.polls.push({ state: "denied" });
    await h.manager.connect();
    await Bun.sleep(20);
    expect(h.manager.status().error).toBe("TUNNEL_PAIRING_DENIED");

    h.api.polls.push({ state: "expired" });
    await h.manager.connect();
    await Bun.sleep(20);
    expect(h.manager.status().error).toBe("TUNNEL_PAIRING_EXPIRED");

    await h.manager.connect();
    h.manager.cancelConnect();
    await Bun.sleep(20);
    expect(h.manager.status().pairing).toBeNull();
    expect(h.manager.status().account).toBeNull();
  });

  test("config dibangun ulang (0600), online dari log, stop membunuh proses", async () => {
    const h = harness();
    await pair(h);
    const cfg = path.join(h.dir, "frpc.toml");
    const toml = readFileSync(cfg, "utf8");
    expect(toml).toContain('metadatas.token = "secret-1"');
    expect(toml).not.toContain('"old"');
    expect(statSync(cfg).mode & 0o777).toBe(0o600);
    expect(h.api.calls).toContain("config:dev-token-1:3000");

    h.procs[0]?.push("[demo] start proxy success");
    await Bun.sleep(5);
    expect(h.manager.status().phase).toBe("online");

    const stopped = await h.manager.stop();
    expect(stopped.phase).toBe("stopped");
    expect(stopped.enabled).toBe(false);
  });

  test("crash -> restart otomatis; ditolak server -> berhenti permanen", async () => {
    const h = harness();
    await pair(h);
    h.procs[0]?.exit(1);
    await Bun.sleep(40);
    expect(h.procs).toHaveLength(2);

    h.procs[1]?.push("login to the server failed: authorization failed");
    await Bun.sleep(5);
    h.procs[1]?.exit(1);
    await Bun.sleep(40);
    expect(h.procs).toHaveLength(2);
    expect(h.manager.status().phase).toBe("error");
    expect(h.manager.status().error).toBe("TUNNEL_AUTH_FAILED");
  });

  test("device dicabut di VPS -> akun lokal dilupakan", async () => {
    const h = harness();
    await pair(h);
    await h.manager.stop();
    h.api.revoked.v = true;
    const r = await h.manager.start();
    expect(r).toEqual({ ok: false, error: "TUNNEL_DEVICE_REVOKED" });
    const s = h.manager.status();
    expect(s.account).toBeNull();
    expect(s.error).toBe("TUNNEL_DEVICE_REVOKED");
    expect(existsSync(path.join(h.dir, "frpc.toml"))).toBe(false);
  });

  test("kunci dihapus -> tunnel dimatikan", async () => {
    const h = harness();
    await pair(h);
    h.protectedApp.v = false;
    h.manager.handleLockChanged(false);
    await Bun.sleep(10);
    const s = h.manager.status();
    expect(s.enabled).toBe(false);
    expect(s.phase).toBe("stopped");
    expect(s.error).toBe("TUNNEL_LOCK_REQUIRED");
  });

  test("rotate secret memulai ulang dengan secret baru", async () => {
    const h = harness();
    await pair(h);
    const r = await h.manager.rotateSecret();
    expect(r.ok).toBe(true);
    expect(h.procs).toHaveLength(2);
    expect(readFileSync(path.join(h.dir, "frpc.toml"), "utf8")).toContain("secret-2");
  });

  test("sign out mencabut device di VPS & menghapus akun + config", async () => {
    const h = harness();
    await pair(h);
    const s = await h.manager.signOut();
    expect(s.phase).toBe("signed_out");
    expect(s.account).toBeNull();
    expect(h.api.calls).toContain("revoke:dev-token-1");
    expect(existsSync(path.join(h.dir, "frpc.toml"))).toBe(false);
  });

  test("autoStart menyalakan ulang tunnel yang sebelumnya aktif", async () => {
    const h = harness();
    await pair(h);
    await h.manager.shutdown(); // enabled tetap true
    expect(h.manager.status().enabled).toBe(true);
    h.manager.autoStart();
    await Bun.sleep(10);
    expect(h.procs).toHaveLength(2);
  });

  test("log memakai kursor absolut", async () => {
    const h = harness();
    await pair(h);
    const a = h.manager.logs(0);
    expect(a.lines.length).toBeGreaterThan(0);
    expect(a.lines.join("\n")).not.toContain("secret-1");
    expect(h.manager.logs(a.next).lines).toEqual([]);
  });
});
