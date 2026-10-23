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
import { clientIp, sessionCookie } from "./auth-guard";
import { errorResponse, json, readObject, respond } from "./helpers";
import type { ApiRouteContext } from "./types";

export function passkeyRoutes(ctx: ApiRouteContext) {
  const { passkeys } = ctx;
  return {
    "/api/auth/passkeys/availability": {
      GET: (req: Request) => json(passkeys.availability(req)),
    },

    "/api/auth/passkeys/login/options": {
      POST: async (req: Request, server: Server<unknown>) =>
        respond(await passkeys.authenticationOptions(req, clientIp(req, server)), (d) => d),
    },

    "/api/auth/passkeys/login": {
      POST: async (req: Request, server: Server<unknown>) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
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
      },
    },

    "/api/auth/passkeys": {
      GET: (req: Request) => json({ passkeys: passkeys.list(req) }),
    },

    "/api/auth/passkeys/register/options": {
      POST: async (req: Request, server: Server<unknown>) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const res = await passkeys.registrationOptions(
          req,
          typeof b.current === "string" ? b.current : "",
          clientIp(req, server),
        );
        return respond(res, (d) => d);
      },
    },

    "/api/auth/passkeys/register": {
      POST: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const res = await passkeys.register(req, {
          challengeId: typeof b.challengeId === "string" ? b.challengeId : "",
          response: b.response as never,
          name: typeof b.name === "string" ? b.name : undefined,
        });
        return respond(res, (passkey) => ({ passkey }));
      },
    },

    "/api/auth/passkeys/:id": {
      PATCH: async (req: BunRequest<"/api/auth/passkeys/:id">) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const res = passkeys.rename(req.params.id, typeof b.name === "string" ? b.name : "");
        return respond(res, (passkey) => ({ passkey }));
      },
      DELETE: (req: BunRequest<"/api/auth/passkeys/:id">) =>
        respond(passkeys.remove(req.params.id), () => ({ ok: true })),
    },
  };
}
