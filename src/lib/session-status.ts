/**
 * Pemetaan status Session & koneksi WS ke label/visual UI (murni, tanpa DOM).
 *
 * Dipakai header chat (`SessionHeader`) dan daftar Session (`SessionList`),
 * agar warna titik & teks status tidak didefinisikan ganda.
 */
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import type { SessionStatus } from "@/types";

/** Warna titik status Session (sepadan di header chat & baris daftar). */
export const SESSION_STATUS_DOT: Record<SessionStatus, string> = {
  running: "bg-emerald-500",
  stopped: "bg-muted-foreground/50",
  crashed: "bg-destructive",
};

/** Label teks status Session (dipakai badge di daftar Session). */
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  running: "Running",
  stopped: "Stopped",
  crashed: "Crashed",
};

/** Variant Badge shadcn untuk sebuah status Session. */
export function sessionStatusVariant(
  status: SessionStatus,
): "default" | "secondary" | "destructive" {
  if (status === "running") return "default";
  if (status === "crashed") return "destructive";
  return "secondary";
}

/** Label status koneksi WS untuk UI (mis. subtitle header chat). */
export function wsStatusLabel(status: WsConnectionStatus): string {
  switch (status) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting…";
    case "reconnecting":
      return "reconnecting…";
    default:
      return "disconnected";
  }
}
