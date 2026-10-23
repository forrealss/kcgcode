/**
 * Tabel rute API Preview (dev server Project yang dipegang kcgcode).
 *
 * - `GET  /api/projects/:id/preview`            config + status dev server
 * - `POST /api/projects/:id/preview/start`      start / restart
 * - `POST /api/projects/:id/preview/stop`
 * - `GET  /api/projects/:id/preview/logs?from=` baris log mulai indeks n
 * - `POST /api/projects/:id/preview/open`       URL sekali pakai ke origin preview
 *   (body opsional `{ sessionId }`: Session chat yang dihubungkan ke overlay)
 * - `POST /api/projects/:id/preview/snapshot`   JPEG halaman dev server (Chrome
 *   headless; body opsional `{ path, width, height, dpr }`) — juga jalan
 *   keluar saat remote access lewat localhost.run
 * - `GET  /api/sessions/:id/preview-snapshot`   snapshot otomatis terakhir
 *
 * Seluruhnya dijaga `guardRoutes` (sesi + Origin). Start adalah aksi eksplisit
 * pengguna setelah melihat perintahnya — config bisa ditulis agent.
 */
import type { BunRequest } from "bun";
import { formatCommand, resolveLaunchConfig } from "../services/preview/launch-config";
import { PREVIEW_AUTH_PATH } from "../services/preview/preview-server";
import { readSessionToken } from "./auth-guard";
import { errorResponse, json, queryInt, readObject, withProject } from "./helpers";
import type { ApiRouteContext } from "./types";

type Req<P extends string> = BunRequest<P>;

/** Host yang dituju browser (frps & proxy lokal meneruskan Host asli). */
function requestHost(req: Request): string {
  return req.headers.get("host") ?? new URL(req.url).host;
}

function isHttps(req: Request): boolean {
  if (new URL(req.url).protocol === "https:") return true;
  return req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

/**
 * Origin preview untuk browser yang membuat request ini:
 * - lewat tunnel KCG (`<user>.<domain>`) -> `https://<user>--preview.<domain>`;
 * - lewat localhost.run -> belum didukung (satu URL acak, tanpa subdomain kedua);
 * - lokal / LAN -> host yang sama dengan port listener preview.
 */
export function previewOrigin(
  req: Request,
  ctx: Pick<ApiRouteContext, "tunnel" | "lhr">,
  previewPort: number,
): { ok: true; origin: string } | { ok: false; error: string } {
  const host = requestHost(req).toLowerCase();
  const account = ctx.tunnel.status().account;
  if (account) {
    const tunnelHost = new URL(account.url).host.toLowerCase();
    const prefix = `${account.username}.`;
    if (host === tunnelHost && tunnelHost.startsWith(prefix)) {
      const domain = tunnelHost.slice(prefix.length);
      return { ok: true, origin: `https://${account.username}--preview.${domain}` };
    }
  }
  const lhrUrl = ctx.lhr.status().url;
  if (lhrUrl && new URL(lhrUrl).host.toLowerCase() === host) {
    return { ok: false, error: "PREVIEW_TUNNEL_UNSUPPORTED" };
  }
  const hostname = new URL(`http://${host}`).hostname;
  return { ok: true, origin: `${isHttps(req) ? "https" : "http"}://${hostname}:${previewPort}` };
}

/** Body JSON opsional (hanya bila content-type JSON); selain objek -> null. */
async function optionalBody(req: Request): Promise<Record<string, unknown> | null> {
  return req.headers.get("content-type")?.includes("json") ? await readObject(req) : null;
}

export function previewRoutes(ctx: ApiRouteContext) {
  const { devServers, preview, screenshotter, snapshots } = ctx;

  return {
    "/api/projects/:id/preview": {
      GET: (req: Req<"/api/projects/:id/preview">) =>
        withProject(ctx, req.params.id, (p) => {
          const cfg = resolveLaunchConfig(p.path);
          return json({
            config: cfg
              ? {
                  source: cfg.source,
                  name: cfg.name,
                  command: formatCommand(cfg.argv),
                  port: cfg.port,
                }
              : null,
            server: devServers.status(p.id),
          });
        }),
    },

    "/api/projects/:id/preview/start": {
      POST: (req: Req<"/api/projects/:id/preview/start">) =>
        withProject(ctx, req.params.id, async (p) => {
          const cfg = resolveLaunchConfig(p.path);
          if (!cfg) return errorResponse("PREVIEW_NO_CONFIG");
          const res = await devServers.start(p.id, cfg);
          if (!res.ok) return errorResponse(res.error);
          return json({ server: res.data });
        }),
    },

    "/api/projects/:id/preview/stop": {
      POST: (req: Req<"/api/projects/:id/preview/stop">) =>
        withProject(ctx, req.params.id, async (p) => json({ server: await devServers.stop(p.id) })),
    },

    "/api/projects/:id/preview/logs": {
      GET: (req: Req<"/api/projects/:id/preview/logs">) =>
        withProject(ctx, req.params.id, (p) => json(devServers.logs(p.id, queryInt(req, "from")))),
    },

    "/api/projects/:id/preview/snapshot": {
      POST: (req: Req<"/api/projects/:id/preview/snapshot">) =>
        withProject(ctx, req.params.id, async (p) => {
          if (!screenshotter.available()) return errorResponse("PREVIEW_NO_BROWSER");
          const up = devServers.upstream(p.id);
          if (!up) return errorResponse("PREVIEW_NOT_RUNNING");
          const opts = (await optionalBody(req)) as {
            path?: unknown;
            width?: number;
            height?: number;
            dpr?: number;
          } | null;
          const path =
            typeof opts?.path === "string" && opts.path.startsWith("/")
              ? opts.path
              : preview.lastView(p.id).path;
          const host = up.host.includes(":") ? `[${up.host}]` : up.host;
          const shot = await screenshotter.capture(`http://${host}:${up.port}${path}`, {
            width: opts?.width,
            height: opts?.height,
            dpr: opts?.dpr,
          });
          if (!shot.ok) return errorResponse(shot.error);
          return new Response(shot.data, {
            headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
          });
        }),
    },

    "/api/sessions/:id/preview-snapshot": {
      GET: (req: Req<"/api/sessions/:id/preview-snapshot">) =>
        json({ snapshot: snapshots.latest(req.params.id) }),
    },

    "/api/projects/:id/preview/open": {
      POST: (req: Req<"/api/projects/:id/preview/open">) =>
        withProject(ctx, req.params.id, async (p) => {
          const origin = previewOrigin(req, ctx, preview.port);
          if (!origin.ok) return errorResponse(origin.error);
          const raw = (await optionalBody(req))?.sessionId;
          const sessionId = typeof raw === "string" && /^[\w-]{1,128}$/.test(raw) ? raw : null;
          const appOrigin = `${isHttps(req) ? "https" : "http"}://${requestHost(req)}`;
          const ticket = preview.issueTicket(
            { projectId: p.id, sessionId, appOrigin },
            readSessionToken(req),
          );
          return json({ url: `${origin.origin}${PREVIEW_AUTH_PATH}?t=${ticket}` });
        }),
    },
  };
}
