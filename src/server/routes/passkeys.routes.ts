/**
 * Tabel rute API passkey (WebAuthn).
 *
 * Publik (lock screen, sebelum login):
 * - `GET  /api/auth/passkeys/availability`   `{ supported, count }` untuk alamat ini
 * - `POST /api/auth/passkeys/login/options`  -> `{ challengeId, options }`
 * - `POST /api/auth/passkeys/login`          `{ challengeId, response }` -> cookie sesi
 *
 * Wajib login — dijaga `guardRoutes`:
 * - `GET    /api/auth/passkeys`                   daftar passkey
 * - `POST   /api/auth/passkeys/register/options`  `{ current }` -> `{ challengeId, options }`
 * - `POST   /api/auth/passkeys/register`          `{ challengeId, response, name? }`
 * - `PATCH  /api/auth/passkeys/:id`               `{ name }`
 * - `DELETE /api/auth/passkeys/:id`
 */
import type { BunRequest, Server } from "bun";
import type { AuthService } from "../services/auth";
import type { PasskeyService } from "../services/auth-passkeys";
import { clientIp, sessionCookie } from "./auth-guard";
import { errorStatus, json, readJson, serverError } from "./helpers";

function rateLimited(code: string): number | null {
  if (!code.startsWith("AUTH_RATE_LIMITED:")) return null;
  const n = Number(code.slice("AUTH_RATE_LIMITED:".length));
  return Number.isFinite(n) ? n : null;
}

function errorResponse(code: string): Response {
  const wait = rateLimited(code);
  if (wait !== null) {
    return new Response(JSON.stringify({ error: "AUTH_RATE_LIMITED", retryAfterSec: wait }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(wait) },
    });
  }
  return json({ error: code }, errorStatus(code));
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const res = await readJson(req);
  if (!res.ok || res.data === null || typeof res.data !== "object") return null;
  return res.data as Record<string, unknown>;
}

export function passkeyRoutes(_auth: AuthService, passkeys: PasskeyService) {
  return {
    "/api/auth/passkeys/availability": {
      GET: (req: Request) => {
        try {
          return json(passkeys.availability(req));
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/passkeys/login/options": {
      POST: async (req: Request, server: Server<unknown>) => {
        try {
          const res = await passkeys.authenticationOptions(req, clientIp(req, server));
          if (!res.ok) return errorResponse(res.error);
          return json(res.data);
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/passkeys/login": {
      POST: async (req: Request, server: Server<unknown>) => {
        try {
          const b = await body(req);
          if (!b) return json({ error: "INVALID_JSON" }, 400);
          const res = await passkeys.login(
            req,
            {
              challengeId: typeof b.challengeId === "string" ? b.challengeId : "",
              response: b.response as never,
            },
            { ip: clientIp(req, server), userAgent: req.headers.get("user-agent") },
          );
          if (!res.ok) return errorResponse(res.error);
          const out = json({ ok: true });
          out.headers.append("set-cookie", sessionCookie(req, res.data.token));
          return out;
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/passkeys": {
      GET: (req: Request) => {
        try {
          return json({ passkeys: passkeys.list(req) });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/passkeys/register/options": {
      POST: async (req: Request, server: Server<unknown>) => {
        try {
          const b = await body(req);
          if (!b) return json({ error: "INVALID_JSON" }, 400);
          const res = await passkeys.registrationOptions(
            req,
            typeof b.current === "string" ? b.current : "",
            clientIp(req, server),
          );
          if (!res.ok) return errorResponse(res.error);
          return json(res.data);
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/passkeys/register": {
      POST: async (req: Request) => {
        try {
          const b = await body(req);
          if (!b) return json({ error: "INVALID_JSON" }, 400);
          const res = await passkeys.register(req, {
            challengeId: typeof b.challengeId === "string" ? b.challengeId : "",
            response: b.response as never,
            name: typeof b.name === "string" ? b.name : undefined,
          });
          if (!res.ok) return errorResponse(res.error);
          return json({ passkey: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/passkeys/:id": {
      PATCH: async (req: BunRequest<"/api/auth/passkeys/:id">) => {
        try {
          const b = await body(req);
          if (!b) return json({ error: "INVALID_JSON" }, 400);
          const res = passkeys.rename(req.params.id, typeof b.name === "string" ? b.name : "");
          if (!res.ok) return errorResponse(res.error);
          return json({ passkey: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
      DELETE: (req: BunRequest<"/api/auth/passkeys/:id">) => {
        try {
          const res = passkeys.remove(req.params.id);
          if (!res.ok) return errorResponse(res.error);
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
