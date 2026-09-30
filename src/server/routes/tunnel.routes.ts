/**
 * Tabel rute API tunnel publik (`https://<username>.<domain>`, domain dari VPS).
 *
 * - `GET  /api/tunnel`                status (tanpa token/secret)
 * - `GET  /api/tunnel/logs?from=<n>`  baris log frpc mulai indeks n
 * - `POST /api/tunnel/connect`        mulai device flow -> kode + URL
 * - `POST /api/tunnel/connect/cancel`
 * - `POST /api/tunnel/start` | `/stop` | `/rotate-secret` | `/signout`
 *
 * Seluruhnya dijaga `guardRoutes` (sesi + Origin). Tanpa app lock, tunnel
 * ditolak (`TUNNEL_LOCK_REQUIRED`).
 */
import { errorStatus, json, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function tunnelRoutes(ctx: ApiRouteContext) {
  const { tunnel } = ctx;
  const wrap =
    <A extends unknown[]>(fn: (...a: A) => Promise<Response> | Response) =>
    async (...a: A) => {
      try {
        return await fn(...a);
      } catch (e) {
        return serverError(e);
      }
    };

  return {
    "/api/tunnel": {
      GET: wrap(() => json({ tunnel: tunnel.status() })),
    },

    "/api/tunnel/logs": {
      GET: wrap((req: Request) => {
        const from = Number(new URL(req.url).searchParams.get("from") ?? "0");
        return json(tunnel.logs(Number.isFinite(from) && from >= 0 ? from : 0));
      }),
    },

    "/api/tunnel/connect": {
      POST: wrap(async () => {
        const res = await tunnel.connect();
        if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
        return json({ tunnel: res.data });
      }),
    },

    "/api/tunnel/connect/cancel": {
      POST: wrap(() => {
        tunnel.cancelConnect();
        return json({ tunnel: tunnel.status() });
      }),
    },

    "/api/tunnel/start": {
      POST: wrap(async () => {
        const res = await tunnel.start();
        if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
        return json({ tunnel: res.data });
      }),
    },

    "/api/tunnel/stop": {
      POST: wrap(async () => json({ tunnel: await tunnel.stop() })),
    },

    "/api/tunnel/rotate-secret": {
      POST: wrap(async () => {
        const res = await tunnel.rotateSecret();
        if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
        return json({ tunnel: res.data });
      }),
    },

    "/api/tunnel/signout": {
      POST: wrap(async () => json({ tunnel: await tunnel.signOut() })),
    },
  };
}
