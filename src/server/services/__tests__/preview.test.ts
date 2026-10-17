/**
 * Preview: resolusi config dev server, supervisor proses, proxy preview
 * (auth tiket, rewrite header, WebSocket), dan proxy frpc `<user>--preview`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { previewOrigin } from "../../routes/preview.routes";
import type { Subscriber } from "../gateway/types";
import { AGENT_MCP_PATH, AGENT_PREVIEW_INSTRUCTIONS, createAgentMcp } from "../preview/agent-mcp";
import { portsFromToolPart } from "../preview/agent-servers";
import type { DevServerManager, DevServerStatus } from "../preview/dev-servers";
import { createDevServerManager, detectPortFromLine } from "../preview/dev-servers";
import { formatCommand, resolveLaunchConfig } from "../preview/launch-config";
import {
  injectOverlay,
  OVERLAY_SCRIPT_PATH,
  type PreviewBridge,
  toOverlayEvent,
  wantsDocument,
} from "../preview/overlay-api";
import { createPreviewServer, PREVIEW_AUTH_PATH, PREVIEW_COOKIE } from "../preview/preview-server";
import {
  clampViewport,
  createScreenshotter,
  findChrome,
  type Screenshotter,
} from "../preview/screenshot";
import { createPreviewSnapshots } from "../preview/snapshots";
import { buildFrpcConfig, classifyFrpcLine } from "../tunnel/frpc-config";

const tmp = mkdtempSync(path.join(tmpdir(), "kcg-preview-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function project(name: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name);
  for (const [f, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), content);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("resolveLaunchConfig", () => {
  test("launch.json wins over package.json", () => {
    const dir = project("launch", {
      ".claude/launch.json": JSON.stringify({
        configurations: [
          { name: "web", runtimeExecutable: "bun", runtimeArgs: ["run", "dev"], port: 5173 },
        ],
      }),
      "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
    });
    expect(resolveLaunchConfig(dir)).toEqual({
      source: "launch.json",
      name: "web",
      argv: ["bun", "run", "dev"],
      port: 5173,
      cwd: dir,
    });
  });

  test("launch.json cwd may not leave the project", () => {
    const dir = project("escape", {
      ".claude/launch.json": JSON.stringify({
        configurations: [{ runtimeExecutable: "sh", cwd: "../.." }],
      }),
    });
    expect(resolveLaunchConfig(dir)).toBeNull();
  });

  test("package.json dev script with the lockfile's package manager", () => {
    const dir = project("pkg", {
      "package.json": JSON.stringify({ scripts: { dev: "next dev", start: "next start" } }),
      "pnpm-lock.yaml": "",
    });
    const cfg = resolveLaunchConfig(dir);
    expect(cfg?.argv).toEqual(["pnpm", "run", "dev"]);
    expect(cfg?.port).toBeNull();
  });

  test("no config -> null", () => {
    expect(resolveLaunchConfig(project("empty", { "README.md": "" }))).toBeNull();
  });

  test("formatCommand quotes only what needs it", () => {
    expect(formatCommand(["bun", "run", "dev"])).toBe("bun run dev");
    expect(formatCommand(["sh", "-c", "echo hi"])).toBe('sh -c "echo hi"');
  });
});

describe("detectPortFromLine", () => {
  test("common dev server banners", () => {
    expect(detectPortFromLine("  ➜  Local:   http://localhost:5173/")).toBe(5173);
    expect(detectPortFromLine("   - Local:        http://localhost:3000")).toBe(3000);
    expect(detectPortFromLine("Listening on http://127.0.0.1:8080")).toBe(8080);
    expect(detectPortFromLine("Server at http://[::1]:4321/")).toBe(4321);
    expect(detectPortFromLine("see https://vitejs.dev/config")).toBeNull();
  });
});

describe("DevServerManager (real process)", () => {
  test("starts, detects the port, proxies upstream, stops the process group", async () => {
    const dir = project("live", { "x.txt": "" });
    const mgr = createDevServerManager({ pollMs: 50 });
    const script = [
      "const s = Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('live') });",
      "console.log('Local: http://localhost:' + s.port + '/');",
    ].join("\n");
    const res = await mgr.start("p1", {
      source: "launch.json",
      name: "live",
      argv: [process.execPath, "-e", script],
      port: null,
      cwd: dir,
    });
    expect(res.ok).toBe(true);
    let status: DevServerStatus | null = null;
    for (let i = 0; i < 100; i++) {
      status = mgr.status("p1");
      if (status?.phase === "running") break;
      await Bun.sleep(50);
    }
    expect(status?.phase).toBe("running");
    const up = mgr.upstream("p1");
    expect(up?.port).toBe(status?.port ?? -1);
    const body = await fetch(`http://${up?.host}:${up?.port}/`).then((r) => r.text());
    expect(body).toBe("live");
    expect(mgr.logs("p1", 0).lines.some((l) => l.includes("Local: http://localhost:"))).toBe(true);

    await mgr.stop("p1");
    expect(mgr.status("p1")?.phase).toBe("stopped");
    expect(mgr.upstream("p1")).toBeNull();
    await expect(fetch(`http://${up?.host}:${up?.port}/`)).rejects.toThrow();
  });
});

describe("preview server proxy", () => {
  const upstream = Bun.serve<{ proto: string }>({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/hmr") {
        const proto = req.headers.get("sec-websocket-protocol") ?? "";
        return server.upgrade(req, {
          data: { proto },
          headers: { "Sec-WebSocket-Protocol": proto },
        })
          ? undefined
          : new Response("no", { status: 400 });
      }
      if (url.pathname === "/page") {
        return new Response(
          "<!doctype html><html><head><title>x</title></head><body>hi</body></html>",
          {
            headers: { "content-type": "text/html", "content-length": "77" },
          },
        );
      }
      if (url.pathname === "/redir") {
        return new Response(null, {
          status: 302,
          headers: { location: `http://localhost:${server.port}/after` },
        });
      }
      const h = new Headers({ "content-type": "application/json" });
      h.append("set-cookie", "sid=1; Domain=localhost; Path=/");
      return new Response(
        JSON.stringify({
          host: req.headers.get("host"),
          cookie: req.headers.get("cookie"),
          origin: req.headers.get("origin"),
          path: url.pathname + url.search,
        }),
        { headers: h },
      );
    },
    websocket: {
      message(ws, msg) {
        ws.send(`echo:${ws.data.proto}:${msg}`);
      },
    },
  });
  let authorized = true;
  let clock = 1_000_000;
  const devServers = {
    status: () => ({ phase: "running" }) as DevServerStatus,
    upstream: () => ({ host: "127.0.0.1", port: upstream.port ?? 0 }),
    touch: () => {},
    connectionOpened: () => {},
    connectionClosed: () => {},
  } as unknown as DevServerManager;
  const preview = createPreviewServer({
    hostname: "127.0.0.1",
    port: 0,
    devServers,
    isAuthorized: () => authorized,
    now: () => clock,
  });
  const base = `http://127.0.0.1:${preview.port}`;
  afterAll(async () => {
    await preview.stop();
    upstream.stop(true);
  });

  async function signIn(): Promise<string> {
    const t = preview.issueTicket(
      { projectId: "p1", sessionId: null, appOrigin: null },
      "main-token",
    );
    const res = await fetch(`${base}${PREVIEW_AUTH_PATH}?t=${t}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toContain("HttpOnly");
    expect(set).not.toContain("Domain=");
    // Tiket sekali pakai.
    const again = await fetch(`${base}${PREVIEW_AUTH_PATH}?t=${t}`, { redirect: "manual" });
    expect(again.status).toBe(401);
    return set.split(";")[0] ?? "";
  }

  test("no cookie -> locked page", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(401);
  });

  test("proxies with a local Host, strips our cookie, rewrites redirects and cookies", async () => {
    const cookie = await signIn();
    const res = await fetch(`${base}/a?b=1`, {
      method: "POST",
      headers: {
        cookie: `${cookie}; theirs=2`,
        host: "alice--preview.example.com",
        origin: "https://alice--preview.example.com",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      host: `localhost:${upstream.port}`,
      cookie: "theirs=2",
      origin: `http://localhost:${upstream.port}`,
      path: "/a?b=1",
    });
    expect(res.headers.get("set-cookie")).toBe("sid=1; Path=/");

    const redir = await fetch(`${base}/redir`, {
      headers: { cookie, host: "alice--preview.example.com", "x-forwarded-proto": "https" },
      redirect: "manual",
    });
    expect(redir.headers.get("location")).toBe("https://alice--preview.example.com/after");
  });

  test("bridges WebSockets (HMR) with the subprotocol", async () => {
    const cookie = await signIn();
    const BunWebSocket = WebSocket as unknown as new (
      url: string,
      options: Bun.WebSocketOptions,
    ) => WebSocket;
    const ws = new BunWebSocket(`ws://127.0.0.1:${preview.port}/hmr`, {
      headers: { cookie },
      protocols: ["vite-hmr"],
    });
    const reply = await new Promise<string>((resolve, reject) => {
      ws.onopen = () => ws.send("ping");
      ws.onmessage = (ev) => resolve(String(ev.data));
      ws.onerror = () => reject(new Error("ws error"));
    });
    expect(reply).toBe("echo:vite-hmr:ping");
    ws.close();
  });

  test("blocks requests triggered by other sites (sibling tunnel subdomains)", async () => {
    const cookie = await signIn();
    const host = "alice--preview.example.com";
    const sub = await fetch(`${base}/`, {
      headers: { cookie, host, "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" },
    });
    expect(sub.status).toBe(403);
    const nav = await fetch(`${base}/`, {
      headers: { cookie, host, "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" },
    });
    expect(nav.status).toBe(200);
    const post = await fetch(`${base}/`, {
      method: "POST",
      headers: { cookie, host, origin: "https://bob.example.com" },
    });
    expect(post.status).toBe(403);
  });

  test("main app sign-out closes the preview after the recheck window", async () => {
    const cookie = await signIn();
    authorized = false;
    expect((await fetch(`${base}/`, { headers: { cookie } })).status).toBe(200);
    clock += 16_000;
    expect((await fetch(`${base}/`, { headers: { cookie } })).status).toBe(401);
    authorized = true;
  });

  test("HTML documents get the overlay script; other responses are untouched", async () => {
    const cookie = await signIn();
    const doc = await fetch(`${base}/page`, {
      headers: { cookie, "sec-fetch-dest": "document", "accept-encoding": "gzip" },
    });
    const html = await doc.text();
    expect(html).toContain(`<head><script src="${OVERLAY_SCRIPT_PATH}" data-kcg-preview></script>`);
    expect(doc.headers.get("content-length")).not.toBe("77");
    const xhr = await fetch(`${base}/page`, { headers: { cookie, "sec-fetch-dest": "empty" } });
    expect(await xhr.text()).not.toContain(OVERLAY_SCRIPT_PATH);

    const js = await fetch(`${base}${OVERLAY_SCRIPT_PATH}`, { headers: { cookie } });
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await js.text()).length).toBeGreaterThan(1000);
  });

  test("cookie name is ours", () => {
    expect(PREVIEW_COOKIE).toBe("__kcg_preview");
  });
});

describe("overlay helpers", () => {
  test("injectOverlay: start of <head>, else after doctype, else prepend", () => {
    const tag = `<script src="${OVERLAY_SCRIPT_PATH}" data-kcg-preview></script>`;
    expect(injectOverlay('<html><head lang="x"><title>t</title>')).toBe(
      `<html><head lang="x">${tag}<title>t</title>`,
    );
    expect(injectOverlay("<!DOCTYPE html><body>x")).toBe(`<!DOCTYPE html>${tag}<body>x`);
    expect(injectOverlay("<p>x</p>")).toBe(`${tag}<p>x</p>`);
    // `<header>` is not `<head>`.
    expect(injectOverlay("<header>x</header>")).toBe(`${tag}<header>x</header>`);
  });

  test("wantsDocument", () => {
    const req = (headers: Record<string, string>, method = "GET") =>
      new Request("http://x/", { method, headers });
    expect(wantsDocument(req({ "sec-fetch-dest": "document" }))).toBe(true);
    expect(wantsDocument(req({ "sec-fetch-dest": "script", accept: "text/html" }))).toBe(false);
    expect(wantsDocument(req({ accept: "text/html,*/*" }))).toBe(true);
    expect(wantsDocument(req({ "sec-fetch-dest": "document" }, "POST"))).toBe(false);
  });

  test("toOverlayEvent keeps only what the overlay shows", () => {
    expect(toOverlayEvent({ type: "turn_active", sessionId: "s", active: true })).toEqual({
      type: "turn",
      active: true,
    });
    const message = (role: "user" | "assistant", text: string, streaming = false) =>
      toOverlayEvent({
        type: "message",
        sessionId: "s",
        message: {
          id: "m",
          sessionId: "s",
          role,
          parts: [{ type: "text", text }],
          createdAt: 1,
          streaming,
        },
      });
    expect(message("assistant", " Done. ")).toEqual({ type: "reply", text: "Done." });
    expect(message("user", "hi")).toBeNull();
    expect(message("assistant", "partial", true)).toBeNull();
    expect(toOverlayEvent({ type: "data_changed" })).toBeNull();
  });
});

describe("overlay API", () => {
  let subscriber: Subscriber | null = null;
  const sent: Array<{ sessionId: string; text: string; images: string[] }> = [];
  const saved: Array<{ size: number; mime: string }> = [];
  const bridge: PreviewBridge = {
    session: (projectId, sessionId) =>
      projectId === "p1" && sessionId === "s1"
        ? { id: "s1", title: "Landing page", status: "running", turnActive: false }
        : null,
    sendPrompt: async (sessionId, text, images) => {
      sent.push({ sessionId, text, images });
      return { ok: true };
    },
    saveImage: (_sessionId, bytes, mime) => {
      saved.push({ size: bytes.length, mime });
      return { ok: true, data: { id: `img${saved.length}` } };
    },
    subscribe: (_sessionId, sub) => {
      subscriber = sub;
      return () => {
        subscriber = null;
      };
    },
  };
  const devServers = {
    status: () => ({ phase: "running", port: 5173 }) as DevServerStatus,
    upstream: () => ({ host: "127.0.0.1", port: 5173 }),
    touch: () => {},
    connectionOpened: () => {},
    connectionClosed: () => {},
  } as unknown as DevServerManager;
  const shots: Array<{ url: string; vp: unknown }> = [];
  const screenshotter: Screenshotter = {
    available: () => true,
    capture: async (url, vp) => {
      shots.push({ url, vp });
      return { ok: true, data: new Uint8Array([0xff, 0xd8, 0xff]) };
    },
    close: async () => {},
  };
  const preview = createPreviewServer({
    hostname: "127.0.0.1",
    port: 0,
    devServers,
    isAuthorized: () => true,
    bridge,
    screenshotter,
  });
  const base = `http://127.0.0.1:${preview.port}`;
  afterAll(() => preview.stop());

  async function signIn(sessionId: string | null): Promise<string> {
    const t = preview.issueTicket(
      { projectId: "p1", sessionId, appOrigin: "https://alice.example.com" },
      null,
    );
    const res = await fetch(`${base}${PREVIEW_AUTH_PATH}?t=${t}`, { redirect: "manual" });
    return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }

  test("state: linked session, chat URL, dev server", async () => {
    const cookie = await signIn("s1");
    const state = await fetch(`${base}/__kcg/preview/api/state`, { headers: { cookie } }).then(
      (r) => r.json(),
    );
    expect(state).toEqual({
      session: { id: "s1", title: "Landing page", status: "running", turnActive: false },
      chatUrl: "https://alice.example.com/projects/p1/sessions/s1",
      server: { phase: "running", port: 5173 },
      screenshots: true,
    });
    // Viewport perangkat dicatat untuk snapshot otomatis.
    await fetch(`${base}/__kcg/preview/api/state?vw=390&vh=800&dpr=3`, { headers: { cookie } });
    expect(preview.lastView("p1").viewport).toEqual({ width: 390, height: 800, dpr: 3 });
  });

  test("prompt: same-origin only, forwarded to the session", async () => {
    const cookie = await signIn("s1");
    const post = (origin: string, text: unknown) =>
      fetch(`${base}/__kcg/preview/api/prompt`, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    expect((await post("https://bob.example.com", "hi")).status).toBe(403);
    expect((await post(base, "  ")).status).toBe(400);
    expect((await post(base, "Make the button smaller")).status).toBe(200);
    expect(sent.at(-1)).toEqual({ sessionId: "s1", text: "Make the button smaller", images: [] });
  });

  test("screenshot of the current page; upload images; prompt carries them", async () => {
    const cookie = await signIn("s1");
    const shot = await fetch(`${base}/__kcg/preview/api/screenshot`, {
      method: "POST",
      headers: { cookie, origin: base, "content-type": "application/json" },
      body: JSON.stringify({ path: "/pricing?x=1", width: 390, height: 844, dpr: 2 }),
    });
    expect(shot.headers.get("content-type")).toBe("image/jpeg");
    expect((await shot.arrayBuffer()).byteLength).toBe(3);
    expect(shots.at(-1)).toEqual({
      url: "http://127.0.0.1:5173/pricing?x=1",
      vp: { path: "/pricing?x=1", width: 390, height: 844, dpr: 2 },
    });

    const upload = (type: string) =>
      fetch(`${base}/__kcg/preview/api/upload`, {
        method: "POST",
        headers: { cookie, origin: base, "content-type": type },
        body: new Uint8Array([1, 2, 3, 4]),
      });
    expect((await upload("text/plain")).status).toBe(415);
    const ok = await upload("image/jpeg");
    expect(await ok.json()).toEqual({ id: `img${saved.length}` });
    expect(saved.at(-1)).toEqual({ size: 4, mime: "image/jpeg" });

    const res = await fetch(`${base}/__kcg/preview/api/prompt`, {
      method: "POST",
      headers: { cookie, origin: base, "content-type": "application/json" },
      body: JSON.stringify({ text: "Fix this", images: ["a", "b", 3, "c", "d", "e"] }),
    });
    expect(res.status).toBe(200);
    expect(sent.at(-1)).toEqual({
      sessionId: "s1",
      text: "Fix this",
      images: ["a", "b", "c", "d"],
    });
  });

  test("prompt without a linked session -> 409", async () => {
    const cookie = await signIn(null);
    const res = await fetch(`${base}/__kcg/preview/api/prompt`, {
      method: "POST",
      headers: { cookie, origin: base },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(409);
  });

  test("events: agent turns and dev server changes over SSE", async () => {
    const cookie = await signIn("s1");
    const ac = new AbortController();
    const res = await fetch(`${base}/__kcg/preview/api/events`, {
      headers: { cookie },
      signal: ac.signal,
    });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const next = async (): Promise<unknown> => {
      while (true) {
        const m = buf.match(/data: (.*)\n\n/);
        if (m?.index !== undefined) {
          buf = buf.slice(m.index + m[0].length);
          return JSON.parse(m[1] ?? "null");
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += decoder.decode(value, { stream: true });
      }
    };
    for (let i = 0; i < 50 && !subscriber; i++) await Bun.sleep(10);
    subscriber?.send({ type: "turn_active", sessionId: "s1", active: true });
    expect(await next()).toEqual({ type: "turn", active: true });
    preview.serverChanged("p1", null);
    expect(await next()).toEqual({ type: "server", server: null });
    ac.abort();
    for (let i = 0; i < 50 && subscriber; i++) await Bun.sleep(10);
    expect(subscriber).toBeNull();
  });
});

describe("DevServerManager idle stop + change events", () => {
  test("stops after idle with no open preview connections", async () => {
    let clock = 0;
    let exit: (code: number) => void = () => {};
    const kills: string[] = [];
    const changes: string[] = [];
    const mgr = createDevServerManager({
      now: () => clock,
      pollMs: 5,
      idleMs: 1000,
      idleCheckMs: 5,
      freePort: async () => 4321,
      probe: async () => "127.0.0.1",
      onChange: (_id, s) => changes.push(s.phase),
      spawn: () => ({
        pid: 1,
        exited: new Promise<number | null>((r) => {
          exit = r;
        }),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
        kill: (sig) => {
          kills.push(sig);
          exit(0);
        },
      }),
    });
    await mgr.start("p", {
      source: "package.json",
      name: "dev",
      argv: ["x"],
      port: null,
      cwd: "/",
    });
    for (let i = 0; i < 50 && mgr.status("p")?.phase !== "running"; i++) await Bun.sleep(5);
    mgr.connectionOpened("p");
    clock = 5000;
    await Bun.sleep(30);
    expect(mgr.status("p")?.phase).toBe("running"); // HMR socket open = active
    mgr.connectionClosed("p");
    clock = 5500;
    await Bun.sleep(30);
    expect(mgr.status("p")?.phase).toBe("running"); // closed just now
    clock = 7000;
    for (let i = 0; i < 50 && mgr.status("p")?.phase !== "stopped"; i++) await Bun.sleep(5);
    expect(mgr.status("p")?.phase).toBe("stopped");
    expect(kills).toEqual(["SIGTERM"]);
    expect(changes).toEqual(["starting", "running", "stopped"]);
    expect(mgr.logs("p", 0).lines.some((l) => l.includes("without preview activity"))).toBe(true);
    await mgr.shutdown();
  });
});

describe("previewOrigin", () => {
  const ctx = {
    tunnel: {
      status: () => ({
        account: { email: "a@x", username: "alice", url: "https://alice.example.com" },
      }),
    },
    lhr: { status: () => ({ url: "https://abc123.lhr.life" }) },
  } as never;
  const req = (host: string, proto?: string) =>
    new Request("http://127.0.0.1:3000/api/x", {
      headers: { host, ...(proto ? { "x-forwarded-proto": proto } : {}) },
    });

  test("KCG tunnel -> <user>--preview subdomain", () => {
    expect(previewOrigin(req("alice.example.com", "https"), ctx, 3001)).toEqual({
      ok: true,
      origin: "https://alice--preview.example.com",
    });
  });

  test("local / LAN -> same host, preview port", () => {
    expect(previewOrigin(req("localhost:3000"), ctx, 3001)).toEqual({
      ok: true,
      origin: "http://localhost:3001",
    });
    expect(previewOrigin(req("192.168.1.5:3000"), ctx, 3001)).toEqual({
      ok: true,
      origin: "http://192.168.1.5:3001",
    });
  });

  test("localhost.run -> unsupported", () => {
    expect(previewOrigin(req("abc123.lhr.life", "https"), ctx, 3001)).toEqual({
      ok: false,
      error: "PREVIEW_TUNNEL_UNSUPPORTED",
    });
  });
});

describe("frpc preview proxy", () => {
  const base = {
    serverAddr: "frp.example.com",
    serverPort: 7000,
    username: "alice",
    tunnelSecret: "s3cret",
    localIp: "127.0.0.1",
    localPort: 3000,
  };

  test("adds <user>--preview only when a preview port is known", () => {
    expect(buildFrpcConfig(base)).not.toContain("--preview");
    const toml = buildFrpcConfig({ ...base, previewPort: 3001 });
    expect(toml).toContain('subdomain = "alice--preview"');
    expect(toml).toContain("localPort = 3001");
  });

  test("a rejected preview proxy doesn't fail the tunnel", () => {
    expect(
      classifyFrpcLine("[W] [control.go:179] [abc] [alice--preview] start error: subdomain"),
    ).toBeNull();
    expect(classifyFrpcLine("[W] [control.go:179] [abc] [alice] start error: x")).toBe(
      "proxy_failed",
    );
  });
});

describe("agent dev servers (adoption)", () => {
  test("portsFromToolPart reads tool output only", () => {
    expect(
      portsFromToolPart({
        type: "tool",
        tool: "Bash",
        state: {
          output:
            "> dev\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.5:5173/",
        },
      }),
    ).toEqual([5173]);
    expect(
      portsFromToolPart({
        type: "tool",
        state: { output: [{ type: "text", text: "on http://127.0.0.1:8080" }] },
      }),
    ).toEqual([8080]);
    expect(portsFromToolPart({ type: "text", text: "open http://localhost:3000" })).toEqual([]);
  });

  test("adopts a server the agent started, watches it, detaches without killing it", async () => {
    const agentServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("agent"),
    });
    const port = agentServer.port ?? 0;
    const changes: string[] = [];
    const mgr = createDevServerManager({
      externalPollMs: 10,
      idleMs: 0,
      onChange: (_id, s) => changes.push(`${s.phase}${s.external ? ":ext" : ""}`),
    });
    expect(await mgr.adopt("p", port)).toBe(true);
    expect(mgr.status("p")).toMatchObject({ phase: "running", port, external: true });
    expect(mgr.upstream("p")).toEqual({ host: "127.0.0.1", port });
    expect(await mgr.adopt("p", port)).toBe(false); // sudah ada yang hidup

    await mgr.stop("p");
    expect(mgr.status("p")?.phase).toBe("stopped");
    expect(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())).toBe("agent");

    // Adopsi lagi, lalu server agent mati -> exited.
    expect(await mgr.adopt("p", port)).toBe(true);
    agentServer.stop(true);
    for (let i = 0; i < 100 && mgr.status("p")?.phase === "running"; i++) await Bun.sleep(10);
    expect(mgr.status("p")?.phase).toBe("exited");
    expect(changes).toEqual(["running:ext", "stopped:ext", "running:ext", "exited:ext"]);
    expect(await mgr.adopt("p", 1)).toBe(false); // port tidak menerima koneksi
    await mgr.shutdown();
  });
});

describe("agent MCP (kcg_preview)", () => {
  let status: DevServerStatus | null = null;
  const started: string[] = [];
  const devServers = {
    status: () => status,
    logs: () => ({ lines: ["line 1", "line 2", "Local: http://localhost:5173/"], next: 3 }),
    start: async (projectId: string) => {
      started.push(projectId);
      status = {
        phase: "running",
        command: "bun run dev",
        port: 5173,
        startedAt: 1,
        exitCode: null,
        logOffset: 3,
      };
      return { ok: true, data: status };
    },
  } as unknown as DevServerManager;
  const mcp = createAgentMcp({
    devServers,
    projectPath: (id) => (id === "p1" ? "/proj" : null),
    resolveConfig: () => ({
      source: "package.json",
      name: "dev",
      argv: ["bun", "run", "dev"],
      port: null,
      cwd: "/proj",
    }),
  });
  const call = (body: unknown, token = mcp.tokenFor("p1"), project = "p1") =>
    mcp.handle(
      new Request(`http://127.0.0.1:3000${AGENT_MCP_PATH}?project=${project}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const rpc = async (method: string, params?: unknown) =>
    (await (await call({ jsonrpc: "2.0", id: 1, method, params })).json()) as {
      result?: Record<string, unknown> & { content?: { text: string }[]; isError?: boolean };
      error?: { code: number };
    };

  test("token is per project", async () => {
    expect((await call({ jsonrpc: "2.0", id: 1, method: "ping" }, "nope")).status).toBe(401);
    expect(
      (await call({ jsonrpc: "2.0", id: 1, method: "ping" }, mcp.tokenFor("p1"), "p2")).status,
    ).toBe(401);
    expect(mcp.tokenFor("p1")).not.toBe(mcp.tokenFor("p2"));
  });

  test("initialize, notifications, tools/list", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "kcg_preview" },
    });
    expect((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await rpc("tools/list");
    const tools = (list.result?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual([
      "dev_server_status",
      "dev_server_logs",
      "dev_server_restart",
    ]);
    expect((await rpc("nope")).error?.code).toBe(-32601);
  });

  test("tools/call: status, logs, restart", async () => {
    const before = await rpc("tools/call", { name: "dev_server_status", arguments: {} });
    expect(before.result?.content?.[0]?.text).toContain("Dev server: not started.");
    expect(before.result?.content?.[0]?.text).toContain("Config: bun run dev (from package.json)");

    const logs = await rpc("tools/call", { name: "dev_server_logs", arguments: { lines: 2 } });
    expect(logs.result?.content?.[0]?.text).toBe("line 2\nLocal: http://localhost:5173/");

    const restart = await rpc("tools/call", { name: "dev_server_restart", arguments: {} });
    expect(restart.result?.isError).toBe(false);
    expect(restart.result?.content?.[0]?.text).toContain("Dev server: running on port 5173.");
    expect(started).toEqual(["p1"]);
  });

  test("instructions name the tools and don't embed a port", () => {
    expect(AGENT_PREVIEW_INSTRUCTIONS).toContain("dev_server_restart");
    expect(AGENT_PREVIEW_INSTRUCTIONS).not.toMatch(/localhost:\d/);
  });
});

describe("screenshots", () => {
  test("clampViewport keeps sizes sane", () => {
    expect(clampViewport({})).toEqual({ width: 390, height: 844, dpr: 2, mobile: true });
    expect(clampViewport({ width: 99999, height: 1, dpr: 9 })).toEqual({
      width: 1920,
      height: 320,
      dpr: 3,
      mobile: false,
    });
  });

  test("findChrome honours KCG_CHROME_PATH", () => {
    expect(findChrome({ KCG_CHROME_PATH: "/nope/chrome" })).toBeNull();
    expect(findChrome({ KCG_CHROME_PATH: process.execPath })).toBe(process.execPath);
  });

  test("no browser -> PREVIEW_NO_BROWSER", async () => {
    const s = createScreenshotter({ chromePath: null });
    expect(s.available()).toBe(false);
    expect(await s.capture("http://127.0.0.1:1/")).toEqual({
      ok: false,
      error: "PREVIEW_NO_BROWSER",
    });
  });

  test.skipIf(!findChrome())(
    "captures a real page with the installed browser",
    async () => {
      const page = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response("<h1>hi</h1>", { headers: { "content-type": "text/html" } }),
      });
      const s = createScreenshotter({ idleCloseMs: 100, settleMs: 50 });
      try {
        const res = await s.capture(`http://127.0.0.1:${page.port}/`, {
          width: 320,
          height: 480,
          dpr: 1,
        });
        expect(res.ok).toBe(true);
        if (res.ok) expect([...res.data.slice(0, 2)]).toEqual([0xff, 0xd8]); // JPEG
      } finally {
        await s.close();
        page.stop(true);
      }
    },
    30_000,
  );
});

describe("preview snapshots after a turn", () => {
  function setup(opts: { upstream?: boolean; enabled?: boolean } = {}) {
    const notified: Array<{ sessionId: string; attachmentId: string; path: string }> = [];
    const removed: string[] = [];
    let n = 0;
    const captured: string[] = [];
    const snaps = createPreviewSnapshots({
      devServers: {
        upstream: () => (opts.upstream === false ? null : { host: "127.0.0.1", port: 5173 }),
      } as unknown as DevServerManager,
      screenshotter: {
        available: () => true,
        capture: async (url) => {
          captured.push(url);
          return { ok: true, data: new Uint8Array([1]) };
        },
        close: async () => {},
      },
      projectOf: () => "p1",
      lastView: () => ({ path: "/cart", viewport: { width: 390 } }),
      save: () => ({ ok: true, data: { id: `a${++n}` } }),
      remove: (_s, id) => removed.push(id),
      notify: (sessionId, s) =>
        notified.push({ sessionId, attachmentId: s.attachmentId, path: s.path }),
      enabled: opts.enabled ?? true,
      delayMs: 0,
      now: () => 42,
    });
    return { snaps, notified, removed, captured };
  }

  test("captures the last viewed page and keeps only the latest", async () => {
    const t = setup();
    await t.snaps.onTurnEnd("s1", "done");
    await t.snaps.onTurnEnd("s1", "done");
    expect(t.captured).toEqual(["http://127.0.0.1:5173/cart", "http://127.0.0.1:5173/cart"]);
    expect(t.notified.map((x) => x.attachmentId)).toEqual(["a1", "a2"]);
    expect(t.removed).toEqual(["a1"]);
    expect(t.snaps.latest("s1")).toEqual({ attachmentId: "a2", path: "/cart", takenAt: 42 });
  });

  test("skips failed turns, stopped dev servers, and when disabled", async () => {
    const failed = setup();
    await failed.snaps.onTurnEnd("s1", "failed");
    const stopped = setup({ upstream: false });
    await stopped.snaps.onTurnEnd("s1", "done");
    const off = setup({ enabled: false });
    await off.snaps.onTurnEnd("s1", "done");
    expect([failed, stopped, off].flatMap((x) => x.captured)).toEqual([]);
  });
});
