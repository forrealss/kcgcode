/**
 * Hook WebSocket Client (task 22.3).
 *
 * Mengelola koneksi ke `/ws` server KCG Bridge:
 * - `attach(sessionId)` membuka koneksi (bila perlu) dan mengirim pesan
 *   `attach` — setelah reconnect otomatis, `attach` dikirim ulang agar riwayat
 *   tersinkronisasi (Requirement 4.1).
 * - Reconnect otomatis dengan jeda konfigurabel saat koneksi putus tak terduga;
 *   `disconnect()` menutup koneksi secara manual tanpa reconnect.
 * - Pesan masuk (`history`, `output`, `prompt`, `prompt_resolved`,
 *   `session_status`, `error`) diteruskan ke `onMessage` sesuai `ws-protocol.ts`.
 * - Token otentikasi (opsional) dikirim via `?token=` pada upgrade WebSocket,
 *   karena browser WebSocket API tidak mendukung header custom (Requirement 9.3).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../ws-protocol";

export type WsConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export interface UseWebSocketOptions {
  /** URL WebSocket; default: `ws(s)://<host>/ws`. */
  url?: string;
  /** Token otentikasi (dikirim sebagai `?token=` saat upgrade, Req 9.3). */
  token?: string;
  /** Dipanggil untuk setiap pesan Server -> Client. */
  onMessage?: (msg: ServerMessage) => void;
  /** Jeda reconnect setelah koneksi putus tak terduga (ms). */
  reconnectDelayMs?: number;
}

export interface UseWebSocketResult {
  status: WsConnectionStatus;
  /** Buka/reattach ke Session (kirim pesan `attach`). */
  attach(sessionId: string): void;
  /** Kirim pesan Client -> Server sesuai protokol ws-protocol.ts. */
  send(msg: ClientMessage): void;
  /** Tutup koneksi secara manual (tanpa reconnect otomatis). */
  disconnect(): void;
}

function defaultWsUrl(token?: string): string | null {
  if (typeof location === "undefined") return null;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const target = new URL(`${proto}://${location.host}/ws`);
  if (token) target.searchParams.set("token", token);
  return target.toString();
}

export function useWebSocket(opts: UseWebSocketOptions = {}): UseWebSocketResult {
  const { onMessage, reconnectDelayMs = 1500, url, token } = opts;
  const [status, setStatus] = useState<WsConnectionStatus>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const manualRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const buildUrl = useCallback(() => url ?? defaultWsUrl(token), [url, token]);

  const open = useCallback(() => {
    if (wsRef.current) return;
    const target = buildUrl();
    if (!target) return;

    manualRef.current = false;
    setStatus("connecting");
    const ws = new WebSocket(target);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      // Re-attach otomatis setelah reconnect (Requirement 4.1).
      const sid = sessionRef.current;
      if (sid) ws.send(JSON.stringify({ type: "attach", sessionId: sid } satisfies ClientMessage));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        onMessageRef.current?.(msg);
      } catch {
        // Abaikan frame yang bukan JSON valid.
      }
    };
    ws.onerror = () => {
      // Penanganan dilakukan di onclose.
    };
    ws.onclose = () => {
      wsRef.current = null;
      if (manualRef.current) {
        setStatus("closed");
        return;
      }
      setStatus("reconnecting");
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        open();
      }, reconnectDelayMs);
    };
  }, [buildUrl, reconnectDelayMs]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const attach = useCallback(
    (sessionId: string) => {
      sessionRef.current = sessionId;
      if (!wsRef.current) {
        open();
        return;
      }
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "attach", sessionId } satisfies ClientMessage));
      }
      // Bila masih connecting, onopen akan mengirim attach otomatis.
    },
    [open],
  );

  const disconnect = useCallback(() => {
    manualRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("closed");
  }, []);

  // Bersihkan koneksi & timer saat komponen unmount.
  useEffect(() => {
    return () => {
      manualRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return { status, attach, send, disconnect };
}
