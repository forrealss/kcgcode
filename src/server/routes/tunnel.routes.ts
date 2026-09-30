/**
 * Tabel rute API tunnel publik (`https://<username>.<domain>`, domain dari VPS).
 *
 * - `GET  /api/tunnel`                status (tanpa token/secret)
 * - `GET  /api/tunnel/logs?from=<n>`  baris log frpc mulai indeks n
 * - `POST /api/tunnel/connect`        mulai device flow -> kode + URL
 * - `POST /api/tunnel/connect/cancel`
 * - `POST /api/tunnel/start` | `/stop` | `/rotate-secret` | `/signout`
 * - `PUT  /api/tunnel/provider`      `{ provider: "kcg" | "lhr" }` — pindah
 *   penyedia; yang lama dimatikan lebih dulu (hanya satu tunnel aktif).
 * - `GET  /api/tunnel/lhr`, `/lhr/logs`, `POST /lhr/start` | `/lhr/stop` —
 *   tunnel localhost.run (tanpa akun, via ssh).
 *
 * Seluruhnya dijaga `guardRoutes` (sesi + Origin). Tanpa app lock, tunnel
 * ditolak (`TUNNEL_LOCK_REQUIRED`).
 */
import { errorStatus, json, readJson, serverError } from "./helpers";
import type { ApiRouteContext } from "./types";

export function tunnelRoutes(ctx: ApiRouteContext) {
  const { tunnel, lhr } = ctx;
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
      GET: wrap(() =>
        json({ tunnel: tunnel.status(), provider: ctx.tunnelProvider(), lhr: lhr.status() }),
      ),
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
        await lhr.stop();
        ctx.setTunnelProvider("kcg");
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

    // ---- Pilihan penyedia (satu tunnel aktif) ----
    "/api/tunnel/provider": {
      PUT: wrap(async (req: Request) => {
        const body = await readJson(req);
        if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
        const provider = (body.data as { provider?: unknown }).provider;
        if (provider !== "kcg" && provider !== "lhr") {
          return json({ error: "INVALID_PROVIDER" }, 400);
        }
        // Matikan penyedia lain dulu: dua alamat publik sekaligus membingungkan
        // dan memperluas permukaan akses.
        if (provider === "lhr") await tunnel.stop();
        else await lhr.stop();
        ctx.setTunnelProvider(provider);
        return json({ provider, tunnel: tunnel.status(), lhr: lhr.status() });
      }),
    },

    // ---- localhost.run ----
    "/api/tunnel/lhr": {
      GET: wrap(() => json({ lhr: lhr.status() })),
    },

    "/api/tunnel/lhr/logs": {
      GET: wrap((req: Request) => {
        const from = Number(new URL(req.url).searchParams.get("from") ?? "0");
        return json(lhr.logs(Number.isFinite(from) && from >= 0 ? from : 0));
      }),
    },

    "/api/tunnel/lhr/start": {
      POST: wrap(async () => {
        // Pastikan hanya satu tunnel publik aktif.
        await tunnel.stop();
        ctx.setTunnelProvider("lhr");
        const res = await lhr.start();
        if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
        return json({ lhr: res.data });
      }),
    },

    "/api/tunnel/lhr/stop": {
      POST: wrap(async () => json({ lhr: await lhr.stop() })),
    },
  };
}
