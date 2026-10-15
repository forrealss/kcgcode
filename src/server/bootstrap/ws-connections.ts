/**
 * Koneksi WebSocket `/ws`: upgrade (cek Origin + sesi login), handler
 * `Bun.serve({ websocket })` yang meneruskan pesan ke WebSocket_Gateway, dan
 * penegakan kunci aplikasi pada socket yang sudah terbuka (tutup 4401 saat
 * sesi dicabut / terkunci / kedaluwarsa, sapuan berkala).
 */

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { originAllowed, readSessionToken } from "../routes/auth-guard";
import type { AuthService } from "../services/auth";
import type { Subscriber, WebSocketGateway } from "../services/websocket-gateway";
import { bunWsSubscriber, dispatchClientMessage } from "../services/ws-transport";

/**
 * Data per-koneksi WebSocket: id sesi login pemiliknya (null = kunci belum
 * diatur saat koneksi dibuka). Dipakai untuk menutup socket saat sesi itu
 * dicabut / terkunci.
 */
export type WsData = { authSessionId: string | null };

export interface WsConnections {
  /** Handler rute `/ws` (upgrade HTTP -> WebSocket). */
  upgrade: (req: Request, server: Server<WsData>) => Response | undefined;
  /** Handler `websocket` untuk `Bun.serve`. */
  handlers: WebSocketHandler<WsData>;
  /** Kunci baru diatur -> tutup socket yang dibuka tanpa sesi (sebelum dikunci). */
  closeUnauthenticatedSockets(): void;
}

export function createWsConnections(deps: {
  auth: AuthService;
  gateway: WebSocketGateway;
}): WsConnections {
  const { auth, gateway } = deps;
  // Subscriber per koneksi (identitas stabil untuk Map gateway).
  const wsSubs = new Map<ServerWebSocket<WsData>, Subscriber>();

  // Sesi dicabut / terkunci / kedaluwarsa -> tutup WebSocket miliknya agar
  // perangkat itu tidak terus menerima data percakapan.
  auth.onSessionEnded((sessionId) => {
    for (const ws of wsSubs.keys()) {
      if (ws.data.authSessionId === sessionId) ws.close(4401, "locked");
    }
  });

  function closeUnauthenticatedSockets(): void {
    if (!auth.isProtected()) return;
    for (const ws of wsSubs.keys()) {
      if (ws.data.authSessionId === null) ws.close(4401, "locked");
    }
  }

  // WebSocket tidak dibatasi CORS, jadi Origin wajib same-origin dan
  // sesi login wajib valid sebelum upgrade.
  function upgrade(req: Request, server: Server<WsData>): Response | undefined {
    if (!originAllowed(req)) return new Response("Forbidden", { status: 403 });
    let authSessionId: string | null = null;
    if (auth.isProtected()) {
      const session = auth.authenticate(readSessionToken(req));
      if (!session) return new Response("Unauthorized", { status: 401 });
      authSessionId = session.id;
    }
    const upgraded = server.upgrade(req, { data: { authSessionId } });
    if (!upgraded) return new Response("Upgrade WebSocket gagal", { status: 400 });
    return undefined;
  }

  const handlers: WebSocketHandler<WsData> = {
    data: { authSessionId: null } as WsData,
    open(ws) {
      wsSubs.set(ws, bunWsSubscriber(ws));
    },
    message(ws, message) {
      // Socket yang tak terdaftar (sudah ditutup) diabaikan.
      const sub = wsSubs.get(ws);
      if (!sub) return;
      // Setiap pesan dianggap aktivitas: sesi tetap hidup selama dipakai,
      // dan socket milik sesi yang sudah terkunci ditutup.
      if (auth.isProtected()) {
        const alive = ws.data.authSessionId !== null && auth.isSessionAlive(ws.data.authSessionId);
        if (!alive) {
          ws.close(4401, "locked");
          return;
        }
      }
      dispatchClientMessage(gateway, sub, String(message));
    },
    close(ws) {
      const sub = wsSubs.get(ws);
      if (sub) {
        gateway.detach(sub);
        wsSubs.delete(ws);
      }
    },
  };

  return { upgrade, handlers, closeUnauthenticatedSockets };
}

/**
 * Kunci otomatis ditegakkan server: sapu sesi idle/kedaluwarsa berkala.
 * Mengembalikan timer agar bisa dihentikan saat shutdown.
 */
export function startAuthSweep(
  auth: AuthService,
  ws: WsConnections,
): ReturnType<typeof setInterval> {
  const sweepTimer = setInterval(() => {
    try {
      auth.sweep();
      ws.closeUnauthenticatedSockets();
    } catch (e) {
      console.error("[kcg-code] auth sweep gagal:", e);
    }
  }, 30_000);
  sweepTimer.unref?.();
  return sweepTimer;
}
