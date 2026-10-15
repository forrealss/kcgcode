/**
 * `lib/session-api.ts` — path, method, dan body tiap endpoint Session, plus
 * error server diteruskan sebagai `ApiError`. `fetch` global di-spy (tanpa
 * jaringan).
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  deleteSession,
  resumeSession,
  stopSession,
  updateSessionSettings,
} from "@/lib/session-api";

type FetchArgs = Parameters<typeof fetch>;

let calls: FetchArgs[] = [];
let respond: () => Response = () => new Response("{}", { status: 200 });
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  calls = [];
  respond = () => new Response("{}", { status: 200 });
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (...args: FetchArgs) => {
    calls.push(args);
    return respond();
  }) as typeof fetch);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function lastCall(): { path: string; method: string | undefined; body: unknown } {
  const [path, init] = calls.at(-1) ?? [];
  return {
    path: String(path),
    method: init?.method,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
  };
}

describe("session-api — endpoint Session", () => {
  test("resume = POST /api/sessions/:id", async () => {
    await resumeSession("s1");
    expect(lastCall()).toEqual({ path: "/api/sessions/s1", method: "POST", body: undefined });
  });

  test("stop = POST /api/sessions/:id/stop", async () => {
    await stopSession("s1");
    expect(lastCall()).toEqual({ path: "/api/sessions/s1/stop", method: "POST", body: undefined });
  });

  test("hapus = DELETE /api/sessions/:id", async () => {
    await deleteSession("s1");
    expect(lastCall()).toEqual({ path: "/api/sessions/s1", method: "DELETE", body: undefined });
  });

  test("ubah pengaturan = PUT JSON hanya berisi field yang diberikan", async () => {
    await updateSessionSettings("s1", { permissionMode: "plan" });
    expect(lastCall()).toEqual({
      path: "/api/sessions/s1",
      method: "PUT",
      body: { permissionMode: "plan" },
    });
    const headers = new Headers(calls.at(-1)?.[1]?.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("error server diteruskan sebagai ApiError berkode", async () => {
    respond = () => Response.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
    const err = await stopSession("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("SESSION_NOT_FOUND");
  });
});
