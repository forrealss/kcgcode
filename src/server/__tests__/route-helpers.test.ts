/**
 * Unit test helper rute API (src/server/routes/helpers.ts) dan penangkap
 * error tunggal di `guardHandler` (src/server/routes/auth-guard.ts).
 */
import { describe, expect, spyOn, test } from "bun:test";
import type { Project } from "../../types";
import { guardHandler } from "../routes/auth-guard";
import {
  errorResponse,
  errorStatus,
  queryInt,
  readObject,
  respond,
  withProject,
} from "../routes/helpers";
import type { ApiRouteContext } from "../routes/types";
import type { AuthService } from "../services/auth";

describe("errorStatus", () => {
  test("lookup registri, kode berdetail, prefiks, default 500", () => {
    expect(errorStatus("NAME_TAKEN")).toBe(409);
    expect(errorStatus("SERVER_START_FAILED: boom")).toBe(502);
    expect(errorStatus("AGENT_ABORT_FAILED: boom")).toBe(502);
    expect(errorStatus("ERROR")).toBe(500);
  });
});

describe("errorResponse", () => {
  test("kode polos -> { error } + status registri", async () => {
    const res = errorResponse("SESSION_NOT_FOUND");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "SESSION_NOT_FOUND" });
  });

  test("kode berdetail dibalas utuh", async () => {
    const res = errorResponse("PREVIEW_SPAWN_FAILED: ENOENT");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "PREVIEW_SPAWN_FAILED: ENOENT" });
  });

  test("field tambahan ikut di body", async () => {
    const res = errorResponse("WORKSPACE_PROJECTS_OUTSIDE", { projects: [] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "WORKSPACE_PROJECTS_OUTSIDE", projects: [] });
  });

  test("AUTH_RATE_LIMITED:<detik> -> 429 + retryAfterSec + header retry-after", async () => {
    const res = errorResponse("AUTH_RATE_LIMITED:42");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(await res.json()).toEqual({ error: "AUTH_RATE_LIMITED", retryAfterSec: 42 });
  });
});

describe("respond", () => {
  test("Result sukses -> map(data) + status", async () => {
    const res = respond({ ok: true, data: 3 }, (n) => ({ n }), 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ n: 3 });
  });

  test("Result gagal -> errorResponse", async () => {
    const res = respond({ ok: false, error: "PROJECT_NOT_FOUND" }, () => ({}));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "PROJECT_NOT_FOUND" });
  });

  test("SimpleResult gagal tanpa kode -> ERROR / 500", async () => {
    const res = respond({ ok: false }, () => ({ ok: true }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ERROR" });
  });
});

describe("readObject", () => {
  const req = (body: string) => new Request("http://x/", { method: "POST", body });

  test("objek JSON", async () => {
    expect(await readObject(req('{"a":1}'))).toEqual({ a: 1 });
  });

  test("tidak valid / null / primitif -> null", async () => {
    expect(await readObject(req("{"))).toBeNull();
    expect(await readObject(req("null"))).toBeNull();
    expect(await readObject(req('"teks"'))).toBeNull();
    expect(await readObject(req("1"))).toBeNull();
  });
});

describe("queryInt", () => {
  const at = (qs: string) => new Request(`http://x/logs${qs}`);

  test("bilangan >= 0 (dibulatkan ke bawah), selain itu 0", () => {
    expect(queryInt(at("?from=7"), "from")).toBe(7);
    expect(queryInt(at("?from=2.9"), "from")).toBe(2);
    expect(queryInt(at(""), "from")).toBe(0);
    expect(queryInt(at("?from=-3"), "from")).toBe(0);
    expect(queryInt(at("?from=abc"), "from")).toBe(0);
  });
});

describe("withProject", () => {
  const project = { id: "p1", name: "a", path: "/a" } as Project;
  const ctx = {
    projectManager: {
      getProject: (id: string) =>
        id === "p1"
          ? { ok: true as const, data: project }
          : { ok: false as const, error: "PROJECT_NOT_FOUND" },
    },
  } as unknown as Pick<ApiRouteContext, "projectManager">;

  test("Project ada -> fn dipanggil", async () => {
    const res = await withProject(ctx, "p1", (p) => Response.json({ name: p.name }));
    expect(await res.json()).toEqual({ name: "a" });
  });

  test("tidak ada -> 404 tanpa memanggil fn", async () => {
    let called = false;
    const res = await withProject(ctx, "nope", () => {
      called = true;
      return new Response();
    });
    expect(called).toBe(false);
    expect(res.status).toBe(404);
  });
});

describe("guardHandler menangkap error handler", () => {
  const auth = { isProtected: () => false } as unknown as AuthService;
  const server = {} as never;

  test("throw sinkron & promise ditolak -> 500 INTERNAL_ERROR", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const sync = guardHandler(auth, "/api/x", () => {
        throw new Error("boom");
      });
      const async_ = guardHandler(auth, "/api/x", async () => {
        throw new Error("boom");
      });
      for (const h of [sync, async_]) {
        const res = (await h(new Request("http://x/api/x"), server)) as Response;
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "INTERNAL_ERROR" });
      }
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  test("balasan normal diteruskan apa adanya", async () => {
    const h = guardHandler(auth, "/api/x", () => new Response("ok", { status: 201 }));
    const res = (await h(new Request("http://x/api/x"), server)) as Response;
    expect(res.status).toBe(201);
  });
});
