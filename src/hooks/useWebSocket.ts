/**
 * Hook WebSocket Client (task 22.3).
 *
 * Mengelola koneksi ke `/ws` server KCG Code:
 * - `attach(sessionId)` membuka koneksi (bila perlu) dan mengirim pesan
 *   `attach` — setelah reconnect otomatis, `attach` dikirim ulang agar riwayat
 *   tersinkronisasi (Requirement 4.1).
 * - Reconnect otomatis dengan jeda konfigurabel saat koneksi putus tak terduga;
 *   `disconnect()` menutup koneksi secara manual tanpa reconnect.
 * - Pesan masuk (`history`, `output`, `prompt`, `prompt_resolved`,
 *   `session_status`, `error`) diteruskan ke `onMessage` sesuai `ws-protocol.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { markLocked, refreshAuth } from "@/lib/auth";
import type { ClientMessage, ServerMessage } from "../ws-protocol";

/** Kode close server: sesi login dicabut / terkunci (lihat `app.ts`). */
const WS_CLOSE_LOCKED = 4401;

export type WsConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export interface UseWebSocketOptions {
  /** URL WebSocket; default: `ws(s)://<host>/ws`. */
  url?: string;
  /** Dipanggil untuk setiap pesan Server -> Client. */
  onMessage?: (msg: ServerMessage) => void;
  /** Jeda reconnect setelah koneksi putus tak terduga (ms). */
  reconnectDelayMs?: number;
}

export interface UseWebSocketResult {
  status: WsConnectionStatus;
  /** Buka/reattach ke Session (kirim pesan `attach`). */
  attach(sessionId: string): void;
  /**
   * Kirim pesan Client -> Server sesuai protokol ws-protocol.ts.
   * `false` bila socket belum/tidak terbuka (pesan tidak terkirim).
   */
  send(msg: ClientMessage): boolean;
  /** Tutup koneksi secara manual (tanpa reconnect otomatis). */
  disconnect(): void;
}

function defaultWsUrl(): string | null {
  if (typeof location === "undefined") return null;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

export function useWebSocket(opts: UseWebSocketOptions = {}): UseWebSocketResult {
  const { onMessage, reconnectDelayMs = 1500, url } = opts;
  const [status, setStatus] = useState<WsConnectionStatus>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const manualRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Socket saat ini sempat terbuka (membedakan putus vs upgrade ditolak). */
  const openedRef = useRef(false);
  /** Kegagalan membuka koneksi beruntun. */
  const failuresRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const buildUrl = useCallback(() => url ?? defaultWsUrl(), [url]);

  const open = useCallback(() => {
    if (wsRef.current) return;
    const target = buildUrl();
    if (!target) return;

    manualRef.current = false;
    setStatus("connecting");
    const ws = new WebSocket(target);
    wsRef.current = ws;

    // Handler socket lama diabaikan: `disconnect()` + `attach()` beruntun
    // (mis. StrictMode / remount) membuat socket baru sebelum `close` socket
    // lama tiba. Tanpa guard ini `onclose` lama menimpa `wsRef` socket baru
    // dengan null sehingga `send()` diam-diam membuang pesan.
    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      openedRef.current = true;
      failuresRef.current = 0;
      setStatus("connected");
      // Re-attach otomatis setelah reconnect (Requirement 4.1). `!== null`
      // (bukan truthy) agar mode daftar (`attach("")`) ikut dikirim ulang.
      const sid = sessionRef.current;
      if (sid !== null)
        ws.send(JSON.stringify({ type: "attach", sessionId: sid } satisfies ClientMessage));
    };
    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
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
    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (manualRef.current) {
        setStatus("closed");
        return;
      }
      // Server menutup karena sesi MILIK SOCKET INI berakhir. Itu belum tentu
      // berarti perangkat terkunci: setelah ganti kunci, sesi lama dicabut
      // tapi cookie sudah berisi sesi baru. Cek ke server dulu — terkunci ->
      // lock screen; masih valid -> sambung ulang dengan cookie baru.
      if (event.code === WS_CLOSE_LOCKED) {
        setStatus("reconnecting");
        void refreshAuth().then((st) => {
          if (manualRef.current) return;
          if (st?.protected && !st.authenticated) {
            manualRef.current = true;
            setStatus("closed");
            markLocked();
            return;
          }
          open();
        });
        return;
      }
      // Upgrade ditolak (401) tampak sebagai putus biasa di browser; cek
      // status kunci agar tidak reconnect tanpa akhir saat terkunci.
      if (!openedRef.current) {
        failuresRef.current += 1;
        if (failuresRef.current >= 2) {
          void refreshAuth().then((st) => {
            if (st?.protected && !st.authenticated) {
              manualRef.current = true;
              setStatus("closed");
              markLocked();
            }
          });
        }
      }
      openedRef.current = false;
      setStatus("reconnecting");
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        open();
      }, reconnectDelayMs);
    };
  }, [buildUrl, reconnectDelayMs]);

  const send = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
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
