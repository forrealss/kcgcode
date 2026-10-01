/**
 * Tabel rute API kunci aplikasi (lock screen) & pengaturan keamanan.
 *
 * Publik (dibutuhkan lock screen sebelum login):
 * - `GET  /api/auth/status`            status kunci + profil + sisa jeda
 * - `POST /api/auth/login`   {secret}  buka kunci -> cookie sesi
 * - `GET  /api/auth/avatar`            foto profil
 *
 * Wajib login (bila kunci sudah diatur) — dijaga `guardRoutes`:
 * - `POST   /api/auth/logout`          kunci perangkat ini (hapus sesi)
 * - `PUT    /api/auth/lock`            atur/ganti kunci {kind, secret, current?}
 * - `DELETE /api/auth/lock`            hapus kunci {current}
 * - `PATCH  /api/auth/profile`         {nickname}
 * - `PUT    /api/auth/avatar`          multipart `file` | `DELETE` hapus
 * - `PUT    /api/auth/avatar/preset`   {preset} avatar bawaan
 * - `PATCH  /api/auth/settings`        {autoLockMinutes}
 * - `POST   /api/auth/onboarding/complete`  welcome screen selesai
 * - `GET    /api/auth/devices`         sesi aktif per perangkat
 * - `POST   /api/auth/devices/revoke-others`
 * - `DELETE /api/auth/devices/:id`
 */
import type { BunRequest, Server } from "bun";
import type { LockKind } from "../db/auth";
import type { AuthService } from "../services/auth";
import { clearSessionCookie, clientIp, readSessionToken, sessionCookie } from "./auth-guard";
import { errorStatus, json, readJson, serverError } from "./helpers";

/** Kode rate-limit membawa detik tunggu: `AUTH_RATE_LIMITED:<sec>`. */
function rateLimited(code: string): number | null {
  if (!code.startsWith("AUTH_RATE_LIMITED:")) return null;
  const n = Number(code.slice("AUTH_RATE_LIMITED:".length));
  return Number.isFinite(n) ? n : null;
}

function authError(code: string): Response {
  const wait = rateLimited(code);
  if (wait !== null) {
    return new Response(JSON.stringify({ error: "AUTH_RATE_LIMITED", retryAfterSec: wait }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(wait) },
    });
  }
  return json({ error: code }, errorStatus(code));
}

function withCookie(res: Response, cookie: string): Response {
  res.headers.append("set-cookie", cookie);
  return res;
}

export function authRoutes(auth: AuthService) {
  const ctxOf = (req: Request, server: Server<unknown>) => ({
    ip: clientIp(req, server),
    userAgent: req.headers.get("user-agent"),
  });

  return {
    "/api/auth/status": {
      GET: (req: Request, server: Server<unknown>) => {
        try {
          const st = auth.status(readSessionToken(req), clientIp(req, server));
          // Sesi kedaluwarsa / terkunci otomatis -> bersihkan cookie basi.
          const res = json(st);
          if (st.protected && !st.authenticated && readSessionToken(req)) {
            return withCookie(res, clearSessionCookie(req));
          }
          return res;
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/login": {
      POST: async (req: Request, server: Server<unknown>) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { secret } = (body.data ?? {}) as { secret?: unknown };
          const res = await auth.login(
            typeof secret === "string" ? secret : "",
            ctxOf(req, server),
          );
          if (!res.ok) return authError(res.error);
          return withCookie(json({ ok: true }), sessionCookie(req, res.data.token));
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/logout": {
      POST: (req: Request) => {
        try {
          auth.logout(readSessionToken(req));
          return withCookie(json({ ok: true }), clearSessionCookie(req));
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/lock": {
      PUT: async (req: Request, server: Server<unknown>) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { kind, secret, current } = (body.data ?? {}) as {
            kind?: unknown;
            secret?: unknown;
            current?: unknown;
          };
          if ((kind !== "pin" && kind !== "password") || typeof secret !== "string") {
            return json({ error: "LOCK_KIND_INVALID" }, 400);
          }
          const res = await auth.setLock(
            {
              kind: kind as LockKind,
              secret,
              current: typeof current === "string" ? current : undefined,
            },
            ctxOf(req, server),
          );
          if (!res.ok) return authError(res.error);
          // Perangkat yang mengatur kunci langsung login dengan sesi baru.
          return withCookie(json({ ok: true }), sessionCookie(req, res.data.token));
        } catch (e) {
          return serverError(e);
        }
      },
      DELETE: async (req: Request, server: Server<unknown>) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { current } = (body.data ?? {}) as { current?: unknown };
          const res = await auth.removeLock(
            typeof current === "string" ? current : "",
            ctxOf(req, server),
          );
          if (!res.ok) return authError(res.error);
          return withCookie(json({ ok: true }), clearSessionCookie(req));
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/profile": {
      PATCH: async (req: Request) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { nickname } = (body.data ?? {}) as { nickname?: unknown };
          if (nickname !== null && typeof nickname !== "string") {
            return json({ error: "NICKNAME_INVALID" }, 400);
          }
          const res = auth.setNickname(nickname ?? null);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ profile: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/avatar": {
      GET: () => {
        try {
          const av = auth.getAvatar();
          if (!av) return json({ error: "AVATAR_NOT_FOUND" }, 404);
          return new Response(new Blob([new Uint8Array(av.bytes)]), {
            headers: {
              "content-type": av.mime,
              // URL memakai ?v=<versi>, jadi aman di-cache lama.
              "cache-control": "private, max-age=31536000, immutable",
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'",
            },
          });
        } catch (e) {
          return serverError(e);
        }
      },
      PUT: async (req: Request) => {
        try {
          let form: FormData;
          try {
            form = await req.formData();
          } catch {
            return json({ error: "EMPTY_UPLOAD" }, 400);
          }
          const file = form.get("file");
          if (!(file instanceof File)) return json({ error: "EMPTY_UPLOAD" }, 400);
          const res = auth.setAvatar(new Uint8Array(await file.arrayBuffer()), file.type || null);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ profile: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
      DELETE: () => {
        try {
          const res = auth.setAvatar(null, null);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ profile: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/avatar/preset": {
      PUT: async (req: Request) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { preset } = (body.data ?? {}) as { preset?: unknown };
          const res = auth.setAvatarPreset(typeof preset === "string" ? preset : "");
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ profile: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/settings": {
      PATCH: async (req: Request) => {
        try {
          const body = await readJson(req);
          if (!body.ok) return json({ error: "INVALID_JSON" }, 400);
          const { autoLockMinutes } = (body.data ?? {}) as { autoLockMinutes?: unknown };
          const res = auth.setAutoLock(typeof autoLockMinutes === "number" ? autoLockMinutes : -1);
          if (!res.ok) return json({ error: res.error }, errorStatus(res.error));
          return json({ autoLockMinutes: res.data });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    // Welcome screen selesai / dilewati. Dijaga guard: setelah app dikunci,
    // hanya sesi login yang bisa memanggilnya (dan saat itu sudah onboarded).
    "/api/auth/onboarding/complete": {
      POST: () => {
        try {
          auth.completeOnboarding();
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/devices": {
      GET: (req: Request) => {
        try {
          return json({ devices: auth.listDevices(readSessionToken(req)) });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/devices/revoke-others": {
      POST: (req: Request) => {
        try {
          auth.revokeOthers(readSessionToken(req));
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },

    "/api/auth/devices/:id": {
      DELETE: (req: BunRequest<"/api/auth/devices/:id">) => {
        try {
          auth.revokeDevice(req.params.id);
          return json({ ok: true });
        } catch (e) {
          return serverError(e);
        }
      },
    },
  };
}
