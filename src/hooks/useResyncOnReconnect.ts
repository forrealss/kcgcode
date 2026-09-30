/**
 * `useResyncOnReconnect` — muat ulang data setelah koneksi WebSocket
 * TERSAMBUNG ULANG (bukan saat koneksi pertama).
 *
 * Broadcast (status, hapus, data berubah) yang terjadi selama koneksi putus
 * tidak dikirim ulang oleh server, jadi daftar di layar bisa basi. Begitu
 * status kembali `connected` setelah sebelumnya pernah terhubung, `resync`
 * dipanggil sekali untuk menutup celah itu.
 */
import { useEffect, useRef } from "react";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";

export function useResyncOnReconnect(status: WsConnectionStatus, resync: () => unknown): void {
  const wasConnected = useRef(false);
  const lost = useRef(false);
  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  useEffect(() => {
    if (status === "connected") {
      if (wasConnected.current && lost.current) void resyncRef.current();
      wasConnected.current = true;
      lost.current = false;
    } else if (wasConnected.current) {
      lost.current = true;
    }
  }, [status]);
}
