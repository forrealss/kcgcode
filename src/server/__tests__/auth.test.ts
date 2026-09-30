/**
 * Integrasi kunci aplikasi: server nyata (`createKcgServer`) + fetch &
 * WebSocket nyata. Memastikan SELURUH rute `/api/*` terkunci, cookie sesi
 * benar, Origin lintas situs ditolak, dan WebSocket ikut dijaga.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore } from "../../db";
import { createKcgServer, type KcgServer } from "../app";
import { createAuthService } from "../services/auth";
import type { OpenCodeServerManager } from "../services/opencode-server";

/** Server opencode palsu: rute non-auth cukup tidak crash. */
const fakeServers: OpenCodeServerManager = {
  ensureServer: async () => ({ ok: false, error: "SERVER_START_FAILED" }),
  ensureFreshServer: async () => ({ ok: false, error: "SERVER_START_FAILED" }),
  getServer: () => undefined,
  stopServer: async () => {},
  stopAll: async () => {},
  onServerExit: () => {},
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("kunci aplikasi — HTTP & WebSocket", () => {
  let app: KcgServer;
  let root: string;
  let base: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "kcg-auth-"));
    mkdirSync(path.join(root, "proj"), { recursive: true });
    const store = openSessionStore(":memory:");
    app = createKcgServer({
      config: { sandboxRoot: root, configPath: "test" },
      store,
      servers: fakeServers,
      uploadsRoot: path.join(root, "uploads"),
      port: 0,
      auth: createAuthService({
        store,
        hash: async (s) => `h:${s}`,
        verify: async (s, h) => h === `h:${s}`,
      }),
    });
    base = `http://127.0.0.1:${app.server.port}`;
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  const call = (p: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(`${base}${p}`, { ...init, headers, redirect: "manual" });
  };
  const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

  test("tanpa kunci: API terbuka & status melaporkan tidak terlindungi", async () => {
    expect((await call("/api/projects")).status).toBe(200);
    const st = (await (await call("/api/auth/status")).json()) as { protected: boolean };
    expect(st.protected).toBe(false);
  });

  let cookie = "";

  test("atur kunci -> cookie sesi HttpOnly + SameSite=Strict", async () => {
    const res = await call("/api/auth/lock", {
      method: "PUT",
      body: JSON.stringify({ kind: "pin", secret: "482915" }),
    });
    expect(res.status).toBe(200);
    const raw = res.headers.get("set-cookie") ?? "";
    expect(raw).toContain("kcg_session=");
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Strict");
    // HTTP biasa (localhost) -> tanpa Secure; lewat tunnel HTTPS -> Secure.
    expect(raw).not.toContain("Secure");
    cookie = cookieOf(res);
  });

  test("setelah dikunci: SELURUH rute /api/* non-publik -> 401 tanpa cookie", async () => {
    const apiPaths = [
      "/api/projects",
      "/api/projects/x",
      "/api/projects/x/models",
      "/api/projects/x/mcp",
      "/api/projects/x/skills",
      "/api/projects/x/agents",
      "/api/projects/x/skills/install",
      "/api/fs",
      "/api/sessions",
      "/api/sessions/x",
      "/api/sessions/x/files",
      "/api/sessions/x/uploads",
      "/api/sessions/x/stop",
      "/api/uploads/s/i",
      "/api/skills/search?q=react",
      "/api/skills/audit?source=a/b&skill=c",
      "/api/skills/installs",
      "/api/skills/installs/x",
      "/api/skills/installs/x/cancel",
      "/api/auth/logout",
      "/api/auth/lock",
      "/api/auth/profile",
      "/api/auth/settings",
      "/api/auth/devices",
      "/api/auth/devices/revoke-others",
      "/api/auth/devices/x",
      // Publik hanya untuk GET; PUT/DELETE wajib login.
      "/api/auth/avatar",
      "/api/auth/avatar/preset",
      "/api/tunnel",
      "/api/tunnel/logs",
      "/api/tunnel/connect",
      "/api/tunnel/connect/cancel",
      "/api/tunnel/start",
      "/api/tunnel/stop",
      "/api/tunnel/rotate-secret",
      "/api/tunnel/signout",
      "/api/tunnel/provider",
      "/api/tunnel/lhr",
      "/api/tunnel/lhr/logs",
      "/api/tunnel/lhr/start",
      "/api/tunnel/lhr/stop",
    ];
    // Setiap pola rute /api terdaftar (kecuali publik) harus tercakup daftar
    // di atas — rute baru yang belum diuji membuat test ini gagal.
    const PUBLIC = new Set(["/api/auth/status", "/api/auth/login"]);
    const toRegex = (pattern: string) => new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}$`);
    for (const pattern of app.apiRoutePatterns) {
      if (PUBLIC.has(pattern)) continue;
      const re = toRegex(pattern);
      const covered = apiPaths.some((p) => re.test(p.split("?")[0] ?? p));
      expect({ pattern, covered }).toEqual({ pattern, covered: true });
    }
    for (const p of apiPaths) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        // GET avatar memang publik (lock screen).
        if (p === "/api/auth/avatar" && method === "GET") continue;
        const res = await call(p, { method, body: method === "GET" ? undefined : "{}" });
        // 405/404 = method tak terdaftar untuk rute ini (tidak ada handler) — aman.
        expect({ p, method, status: res.status }).toEqual({
          p,
          method,
          status: [404, 405].includes(res.status) ? res.status : 401,
        });
        if (res.status !== 401) continue;
        expect(((await res.json()) as { error: string }).error).toBe("AUTH_REQUIRED");
      }
    }
    // Rute publik lock screen tetap bisa diakses.
    expect((await call("/api/auth/status")).status).toBe(200);
  });

  test("dengan cookie: API bisa dipakai", async () => {
    expect((await call("/api/projects", { cookie })).status).toBe(200);
    const st = (await (await call("/api/auth/status", { cookie })).json()) as {
      protected: boolean;
      authenticated: boolean;
      lockKind: string;
    };
    expect(st).toMatchObject({ protected: true, authenticated: true, lockKind: "pin" });
  });

  test("cookie palsu -> 401; status membersihkan cookie basi", async () => {
    const fake = "kcg_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect((await call("/api/projects", { cookie: fake })).status).toBe(401);
    const st = await call("/api/auth/status", { cookie: fake });
    expect(st.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("Origin lintas situs ditolak untuk request yang mengubah state", async () => {
    const res = await call("/api/auth/profile", {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ nickname: "evil" }),
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    const same = await call("/api/auth/profile", {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ nickname: "Irsyad" }),
      headers: { origin: base },
    });
    expect(same.status).toBe(200);
  });

  test("login: salah -> 401, benar -> cookie baru; rate limit -> 429 + Retry-After", async () => {
    const bad = await call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret: "000000" }),
    });
    expect(bad.status).toBe(401);
    const good = await call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret: "482915" }),
    });
    expect(good.status).toBe(200);
    expect(cookieOf(good)).toMatch(/^kcg_session=/);

    let limited: Response | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ secret: "000000" }),
        headers: { "x-forwarded-for": "9.9.9.9" },
      });
      if (r.status === 429) limited = r;
    }
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("avatar: upload (sniff), GET publik dengan header aman, SVG ditolak", async () => {
    const form = new FormData();
    form.append("file", new File([PNG], "a.png", { type: "image/png" }));
    const up = await fetch(`${base}/api/auth/avatar`, {
      method: "PUT",
      body: form,
      headers: { cookie },
    });
    expect(up.status).toBe(200);
    const { profile } = (await up.json()) as { profile: { avatarUrl: string } };

    // Publik: lock screen menampilkannya sebelum login.
    const img = await call(profile.avatarUrl);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");

    const svg = new FormData();
    svg.append("file", new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/png" }));
    const bad = await fetch(`${base}/api/auth/avatar`, {
      method: "PUT",
      body: svg,
      headers: { cookie },
    });
    expect(bad.status).toBe(400);
  });

  test("WebSocket: tanpa cookie ditolak; dengan cookie terbuka; Origin asing ditolak", async () => {
    const tryWs = (headers: Record<string, string>) =>
      new Promise<"open" | "closed">((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`, { headers } as never);
        ws.onopen = () => {
          ws.close();
          resolve("open");
        };
        ws.onerror = () => resolve("closed");
        ws.onclose = () => resolve("closed");
      });
    expect(await tryWs({})).toBe("closed");
    expect(await tryWs({ cookie })).toBe("open");
    expect(await tryWs({ cookie, origin: "https://evil.example" })).toBe("closed");
  });

  test("logout -> cookie lama tidak berlaku, WebSocket terbuka ditutup", async () => {
    const login = await call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret: "482915" }),
    });
    const c2 = cookieOf(login);
    const closed = new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/ws`, {
        headers: { cookie: c2 },
      } as never);
      ws.onopen = async () => {
        await call("/api/auth/logout", { method: "POST", cookie: c2 });
      };
      ws.onclose = (ev) => resolve(ev.code);
    });
    expect(await closed).toBe(4401);
    expect((await call("/api/projects", { cookie: c2 })).status).toBe(401);
  });

  test("hapus kunci -> API terbuka lagi", async () => {
    const res = await call("/api/auth/lock", {
      method: "DELETE",
      cookie,
      body: JSON.stringify({ current: "482915" }),
    });
    expect(res.status).toBe(200);
    expect((await call("/api/projects")).status).toBe(200);
  });
});
