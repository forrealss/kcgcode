/**
 * Helper HTTP bersama untuk handler rute API (pola kcgcode: helper rute
 * dipisah dari composition root). Dulu menumpuk di `app.ts`; kini dipakai
 * semua tabel rute di `routes/*.routes.ts`.
 */
import type { Project, SessionModel } from "../../types";
import { resolveError } from "../../types/errors";
import type { Result, SimpleResult } from "../result";
import type { ApiRouteContext } from "./types";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function serverError(err: unknown): Response {
  console.error("[kcg-code] error tidak terduga:", err);
  return json({ error: "INTERNAL_ERROR" }, 500);
}

/**
 * Status HTTP kode error domain (design.md — Error Handling) — lookup ke
 * registri `ERRORS` (`types/errors.ts`); kode berdetail (`KODE: …`)
 * dicocokkan lewat kode dasarnya, kode tak dikenal -> 500.
 */
export function errorStatus(code: string): number {
  return resolveError(code).status;
}

/**
 * Balasan error `{ error: code, ...extra }` dengan status dari registri.
 * `AUTH_RATE_LIMITED:<detik>` -> 429 `{ error, retryAfterSec }` + header
 * `retry-after`.
 */
export function errorResponse(code: string, extra?: Record<string, unknown>): Response {
  const err = resolveError(code);
  if (err.code === "AUTH_RATE_LIMITED" && err.detail !== null) {
    const wait = Number(err.detail);
    if (Number.isFinite(wait)) {
      const res = json({ error: err.code, retryAfterSec: wait, ...extra }, err.status);
      res.headers.set("retry-after", String(wait));
      return res;
    }
  }
  return json({ error: code, ...extra }, err.status);
}

/**
 * Balas hasil service: sukses -> `json(map(data), status)`, gagal ->
 * `errorResponse(error)` (SimpleResult tanpa kode -> `ERROR`, 500).
 */
export function respond<T>(res: Result<T>, map: (data: T) => unknown, status?: number): Response;
export function respond(res: SimpleResult, map: () => unknown, status?: number): Response;
export function respond<T>(
  res: Result<T> | SimpleResult,
  map: (data: T) => unknown,
  status = 200,
): Response {
  if (!res.ok) return errorResponse(res.error ?? "ERROR");
  return json(map((res as { data: T }).data), status);
}

/**
 * Body JSON berupa objek; body tidak valid / bukan objek -> `null` sehingga
 * handler membalas 400 `INVALID_JSON` (bukan 500 dari `serverError`).
 */
export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await req.json();
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Query param bilangan bulat >= 0 (mis. `?from=` log bertahap); selain itu 0. */
export function queryInt(req: Request, name: string): number {
  const n = Number(new URL(req.url).searchParams.get(name) ?? "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Jalankan `fn` dengan Project `id`; tidak ada -> balasan error-nya. */
export function withProject(
  ctx: Pick<ApiRouteContext, "projectManager">,
  id: string,
  fn: (project: Project) => Response | Promise<Response>,
): Response | Promise<Response> {
  const p = ctx.projectManager.getProject(id);
  return p.ok ? fn(p.data) : errorResponse(p.error);
}

/**
 * Body `model` pada POST/PUT Session: `{ providerID, modelID }` atau `null`
 * (artinya pakai model default opencode). Bentuk lain dianggap null.
 */
export function parseModelBody(raw: unknown): SessionModel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { providerID, modelID } = raw as { providerID?: unknown; modelID?: unknown };
  if (typeof providerID !== "string" || providerID === "") return null;
  if (typeof modelID !== "string" || modelID === "") return null;
  return { providerID, modelID };
}
