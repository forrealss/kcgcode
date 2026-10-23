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
import { errorResponse, json, queryInt, readObject, respond } from "./helpers";
import type { ApiRouteContext } from "./types";

export function tunnelRoutes(ctx: ApiRouteContext) {
  const { tunnel, lhr } = ctx;
  return {
    "/api/tunnel": {
      GET: () =>
        json({ tunnel: tunnel.status(), provider: ctx.tunnelProvider(), lhr: lhr.status() }),
    },

    "/api/tunnel/logs": {
      GET: (req: Request) => json(tunnel.logs(queryInt(req, "from"))),
    },

    "/api/tunnel/connect": {
      POST: async () => respond(await tunnel.connect(), (t) => ({ tunnel: t })),
    },

    "/api/tunnel/connect/cancel": {
      POST: () => {
        tunnel.cancelConnect();
        return json({ tunnel: tunnel.status() });
      },
    },

    "/api/tunnel/start": {
      POST: async () => {
        await lhr.stop();
        ctx.setTunnelProvider("kcg");
        return respond(await tunnel.start(), (t) => ({ tunnel: t }));
      },
    },

    "/api/tunnel/stop": {
      POST: async () => json({ tunnel: await tunnel.stop() }),
    },

    "/api/tunnel/rotate-secret": {
      POST: async () => respond(await tunnel.rotateSecret(), (t) => ({ tunnel: t })),
    },

    "/api/tunnel/signout": {
      POST: async () => json({ tunnel: await tunnel.signOut() }),
    },

    // ---- Pilihan penyedia (satu tunnel aktif) ----
    "/api/tunnel/provider": {
      PUT: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const provider = b.provider;
        if (provider !== "kcg" && provider !== "lhr") return errorResponse("INVALID_PROVIDER");
        // Matikan penyedia lain dulu: dua alamat publik sekaligus membingungkan
        // dan memperluas permukaan akses.
        if (provider === "lhr") await tunnel.stop();
        else await lhr.stop();
        ctx.setTunnelProvider(provider);
        return json({ provider, tunnel: tunnel.status(), lhr: lhr.status() });
      },
    },

    // ---- localhost.run ----
    "/api/tunnel/lhr": {
      GET: () => json({ lhr: lhr.status() }),
    },

    "/api/tunnel/lhr/logs": {
      GET: (req: Request) => json(lhr.logs(queryInt(req, "from"))),
    },

    "/api/tunnel/lhr/start": {
      POST: async () => {
        // Pastikan hanya satu tunnel publik aktif.
        await tunnel.stop();
        ctx.setTunnelProvider("lhr");
        return respond(await lhr.start(), (status) => ({ lhr: status }));
      },
    },

    "/api/tunnel/lhr/stop": {
      POST: async () => json({ lhr: await lhr.stop() }),
    },
  };
}
