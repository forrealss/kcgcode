/**
 * Workspace (Sandbox_Root) — validasi path, penulisan config, dan rute HTTP.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openSessionStore } from "../../../db";
import type { Project } from "../../../types";
import type { ApiRouteContext } from "../../routes/types";
import { workspaceRoutes } from "../../routes/workspace.routes";
import { createAuthService } from "../auth";
import { createProjectManager } from "../project-manager";
import {
  displayPath,
  expandUserPath,
  isTooBroad,
  projectsOutside,
  validateWorkspaceRoot,
  writeSandboxRoot,
} from "../workspace";

let base: string;
let home: string;
let data: string;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "kcg-ws-"));
  home = path.join(base, "home");
  data = path.join(home, ".kcgcode", "data");
  mkdirSync(path.join(home, "code", "a"), { recursive: true });
  mkdirSync(path.join(home, "work"), { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(path.join(home, "file.txt"), "x");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const opts = (over: Partial<Parameters<typeof validateWorkspaceRoot>[1]> = {}) => ({
  create: false,
  protectedDirs: [data],
  home,
  ...over,
});

describe("util path", () => {
  test("displayPath & expandUserPath memakai ~", () => {
    expect(displayPath(path.join(home, "code"), home)).toBe("~/code");
    expect(displayPath(home, home)).toBe("~");
    expect(displayPath("/srv/x", home)).toBe("/srv/x");
    expect(expandUserPath("~/code", home)).toBe(path.join(home, "code"));
    expect(expandUserPath("relative/x", home)).toBeNull();
  });

  test("isTooBroad: root fs, home, leluhur home, direktori sistem", () => {
    expect(isTooBroad("/", home)).toBe(true);
    expect(isTooBroad(home, home)).toBe(true);
    expect(isTooBroad(path.dirname(home), home)).toBe(true);
    expect(isTooBroad(path.join(home, "code"), home)).toBe(false);
    if (process.platform !== "win32") {
      expect(isTooBroad("/etc", home)).toBe(true);
      expect(isTooBroad("/usr", home)).toBe(true);
    }
  });
});

describe("validateWorkspaceRoot", () => {
  test("folder valid -> realpath", () => {
    const r = validateWorkspaceRoot("~/code", opts());
    expect(r).toEqual({ ok: true, data: { root: path.join(home, "code"), willCreate: false } });
  });

  test("ditolak: kosong, relatif, tidak ada, bukan folder", () => {
    expect(validateWorkspaceRoot("", opts()).ok).toBe(false);
    expect(validateWorkspaceRoot("code", opts())).toMatchObject({
      error: "WORKSPACE_PATH_NOT_ABSOLUTE",
    });
    expect(validateWorkspaceRoot("~/nope", opts())).toMatchObject({ error: "WORKSPACE_NOT_FOUND" });
    expect(validateWorkspaceRoot("~/file.txt", opts())).toMatchObject({
      error: "WORKSPACE_NOT_DIRECTORY",
    });
  });

  test("terlalu luas: home & root fs", () => {
    expect(validateWorkspaceRoot("~", opts())).toMatchObject({ error: "WORKSPACE_TOO_BROAD" });
    expect(validateWorkspaceRoot("/", opts())).toMatchObject({ error: "WORKSPACE_TOO_BROAD" });
  });

  test("tumpang tindih dengan data KCG Code ditolak (dua arah)", () => {
    // Workspace MEMUAT folder data.
    expect(validateWorkspaceRoot("~/.kcgcode", opts())).toMatchObject({
      error: "WORKSPACE_CONTAINS_APP_DATA",
    });
    // Workspace DI DALAM folder data.
    mkdirSync(path.join(data, "inner"), { recursive: true });
    expect(validateWorkspaceRoot(path.join(data, "inner"), opts())).toMatchObject({
      error: "WORKSPACE_CONTAINS_APP_DATA",
    });
  });

  test("symlink dinilai dari lokasi aslinya", () => {
    const link = path.join(home, "link-to-home");
    symlinkSync(home, link);
    expect(validateWorkspaceRoot(link, opts())).toMatchObject({ error: "WORKSPACE_TOO_BROAD" });
  });

  test("create: hanya satu tingkat terakhir yang boleh dibuat", () => {
    expect(validateWorkspaceRoot("~/projects", opts({ create: true }))).toEqual({
      ok: true,
      data: { root: path.join(home, "projects"), willCreate: true },
    });
    expect(validateWorkspaceRoot("~/a/b/c", opts({ create: true }))).toMatchObject({
      error: "WORKSPACE_PARENT_NOT_FOUND",
    });
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "folder tanpa izin tulis ditolak",
    () => {
      const ro = path.join(home, "readonly");
      mkdirSync(ro);
      chmodSync(ro, 0o555);
      try {
        expect(validateWorkspaceRoot(ro, opts())).toMatchObject({
          error: "WORKSPACE_NOT_WRITABLE",
        });
      } finally {
        chmodSync(ro, 0o755);
      }
    },
  );
});

describe("projectsOutside & writeSandboxRoot", () => {
  const proj = (p: string): Project => ({
    id: p,
    name: p,
    path: p,
    createdAt: 0,
    instructions: null,
  });

  test("Project di luar root baru terdeteksi", () => {
    const root = path.join(home, "code");
    const inside = proj(path.join(root, "a"));
    const outside = proj(path.join(home, "work"));
    expect(projectsOutside(root, [inside, outside]).map((p) => p.id)).toEqual([outside.id]);
  });

  test("menulis sandboxRoot & mempertahankan kunci lain", () => {
    const cfg = path.join(base, "config.json");
    writeFileSync(cfg, JSON.stringify({ sandboxRoot: "/old", extra: 1 }));
    expect(writeSandboxRoot(cfg, "/new").ok).toBe(true);
    expect(JSON.parse(readFileSync(cfg, "utf8"))).toEqual({ sandboxRoot: "/new", extra: 1 });
  });
});

describe("rute /api/workspace", () => {
  async function setup(locked: boolean) {
    const store = openSessionStore(":memory:");
    const auth = createAuthService({
      store,
      hash: async (s) => `h:${s}`,
      verify: async (s, h) => h === `h:${s}`,
    });
    if (locked) {
      await auth.setLock({ kind: "pin", secret: "482915" }, { ip: "1.1.1.1", userAgent: null });
    }
    const root = path.join(home, "code");
    const pm = createProjectManager(root, store);
    const cfg = path.join(base, `cfg-${locked ? "l" : "u"}-${Math.random()}.json`);
    writeFileSync(cfg, JSON.stringify({ sandboxRoot: root }));
    let changed = 0;
    const ctx = {
      projectManager: pm,
      notifyDataChanged: () => {
        changed++;
      },
    } as unknown as ApiRouteContext;
    // `home` diinjeksi: "~" mengarah ke folder sementara, BUKAN home asli.
    const routes = workspaceRoutes(ctx, { auth, configPath: cfg, protectedDirs: [data], home });
    const server = { requestIP: () => ({ address: "5.5.5.5" }) } as never;
    const put = (body: unknown) =>
      routes["/api/workspace"].PUT(
        new Request("http://x/api/workspace", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        server,
      );
    return { pm, cfg, put, routes, changed: () => changed };
  }

  test("GET: root aktif, tampilan ~, jumlah project", async () => {
    const h = await setup(false);
    h.pm.createProject("a", "a");
    const res = h.routes["/api/workspace"].GET();
    const body = (await res.json()) as { workspace: { display: string; projectCount: number } };
    expect(body.workspace.display).toBe("~/code");
    expect(body.workspace.projectCount).toBe(1);
  });

  test("terkunci: sandi salah ditolak SEBELUM path divalidasi", async () => {
    const h = await setup(true);
    const res = await h.put({ path: "/", current: "000000" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("CURRENT_SECRET_INVALID");
  });

  test("sukses: config ditulis, root berlaku seketika, klien diberi tahu", async () => {
    const h = await setup(true);
    const res = await h.put({ path: "~/work", current: "482915" });
    expect(res.status).toBe(200);
    expect(h.pm.getSandboxRoot()).toBe(path.join(home, "work"));
    expect(JSON.parse(readFileSync(h.cfg, "utf8")).sandboxRoot).toBe(path.join(home, "work"));
    expect(h.changed()).toBe(1);
    // Folder browser kini memakai root baru.
    expect(h.pm.listDirectory("").ok).toBe(true);
  });

  test("Project di luar root baru -> 409 berisi daftarnya, root tidak berubah", async () => {
    const h = await setup(false);
    h.pm.createProject("a", "a");
    const res = await h.put({ path: "~/work" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; projects: { name: string }[] };
    expect(body.error).toBe("WORKSPACE_PROJECTS_OUTSIDE");
    expect(body.projects.map((p) => p.name)).toEqual(["a"]);
    expect(h.pm.getSandboxRoot()).toBe(path.join(home, "code"));
  });

  test("create: folder baru dibuat lalu dipakai", async () => {
    const h = await setup(false);
    const res = await h.put({ path: "~/fresh-ws", create: true });
    expect(res.status).toBe(200);
    expect(h.pm.getSandboxRoot()).toBe(path.join(home, "fresh-ws"));
  });
});
