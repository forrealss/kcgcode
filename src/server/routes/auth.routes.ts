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
import { clearSessionCookie, clientIp, readSessionToken, sessionCookie } from "./auth-guard";
import { errorResponse, json, readObject, respond } from "./helpers";
import type { ApiRouteContext } from "./types";

function withCookie(res: Response, cookie: string): Response {
  res.headers.append("set-cookie", cookie);
  return res;
}

export function authRoutes(ctx: ApiRouteContext) {
  const { auth } = ctx;
  const ctxOf = (req: Request, server: Server<unknown>) => ({
    ip: clientIp(req, server),
    userAgent: req.headers.get("user-agent"),
  });

  return {
    "/api/auth/status": {
      GET: (req: Request, server: Server<unknown>) => {
        const st = auth.status(readSessionToken(req), clientIp(req, server));
        // Sesi kedaluwarsa / terkunci otomatis -> bersihkan cookie basi.
        const res = json(st);
        if (st.protected && !st.authenticated && readSessionToken(req)) {
          return withCookie(res, clearSessionCookie(req));
        }
        return res;
      },
    },

    "/api/auth/login": {
      POST: async (req: Request, server: Server<unknown>) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const res = await auth.login(
          typeof b.secret === "string" ? b.secret : "",
          ctxOf(req, server),
        );
        if (!res.ok) return errorResponse(res.error);
        return withCookie(json({ ok: true }), sessionCookie(req, res.data.token));
      },
    },

    "/api/auth/logout": {
      POST: (req: Request) => {
        auth.logout(readSessionToken(req));
        return withCookie(json({ ok: true }), clearSessionCookie(req));
      },
    },

    "/api/auth/lock": {
      PUT: async (req: Request, server: Server<unknown>) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { kind, secret, current } = b;
        if ((kind !== "pin" && kind !== "password") || typeof secret !== "string") {
          return errorResponse("LOCK_KIND_INVALID");
        }
        const res = await auth.setLock(
          {
            kind: kind as LockKind,
            secret,
            current: typeof current === "string" ? current : undefined,
          },
          ctxOf(req, server),
        );
        if (!res.ok) return errorResponse(res.error);
        // Perangkat yang mengatur kunci langsung login dengan sesi baru.
        return withCookie(json({ ok: true }), sessionCookie(req, res.data.token));
      },
      DELETE: async (req: Request, server: Server<unknown>) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const res = await auth.removeLock(
          typeof b.current === "string" ? b.current : "",
          ctxOf(req, server),
        );
        if (!res.ok) return errorResponse(res.error);
        return withCookie(json({ ok: true }), clearSessionCookie(req));
      },
    },

    "/api/auth/profile": {
      PATCH: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const { nickname } = b;
        if (nickname !== null && typeof nickname !== "string") {
          return errorResponse("NICKNAME_INVALID");
        }
        return respond(auth.setNickname(nickname), (profile) => ({ profile }));
      },
    },

    "/api/auth/avatar": {
      GET: () => {
        const av = auth.getAvatar();
        if (!av) return errorResponse("AVATAR_NOT_FOUND");
        return new Response(new Blob([new Uint8Array(av.bytes)]), {
          headers: {
            "content-type": av.mime,
            // URL memakai ?v=<versi>, jadi aman di-cache lama.
            "cache-control": "private, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'",
          },
        });
      },
      PUT: async (req: Request) => {
        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          return errorResponse("EMPTY_UPLOAD");
        }
        const file = form.get("file");
        if (!(file instanceof File)) return errorResponse("EMPTY_UPLOAD");
        const res = auth.setAvatar(new Uint8Array(await file.arrayBuffer()), file.type || null);
        return respond(res, (profile) => ({ profile }));
      },
      DELETE: () => respond(auth.setAvatar(null, null), (profile) => ({ profile })),
    },

    "/api/auth/avatar/preset": {
      PUT: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const res = auth.setAvatarPreset(typeof b.preset === "string" ? b.preset : "");
        return respond(res, (profile) => ({ profile }));
      },
    },

    "/api/auth/settings": {
      PATCH: async (req: Request) => {
        const b = await readObject(req);
        if (!b) return errorResponse("INVALID_JSON");
        const minutes = typeof b.autoLockMinutes === "number" ? b.autoLockMinutes : -1;
        return respond(auth.setAutoLock(minutes), (autoLockMinutes) => ({ autoLockMinutes }));
      },
    },

    // Welcome screen selesai / dilewati. Dijaga guard: setelah app dikunci,
    // hanya sesi login yang bisa memanggilnya (dan saat itu sudah onboarded).
    "/api/auth/onboarding/complete": {
      POST: () => {
        auth.completeOnboarding();
        return json({ ok: true });
      },
    },

    "/api/auth/devices": {
      GET: (req: Request) => json({ devices: auth.listDevices(readSessionToken(req)) }),
    },

    "/api/auth/devices/revoke-others": {
      POST: (req: Request) => {
        auth.revokeOthers(readSessionToken(req));
        return json({ ok: true });
      },
    },

    "/api/auth/devices/:id": {
      DELETE: (req: BunRequest<"/api/auth/devices/:id">) => {
        auth.revokeDevice(req.params.id);
        return json({ ok: true });
      },
    },
  };
}
