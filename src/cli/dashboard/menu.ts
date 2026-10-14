/** Menu dashboard: item, hint per item, teks konfirmasi, dan validasi port. */
import type { DashboardMode, DashboardSnapshot } from "./snapshot";

/** State tampilan dinamis; semua opsional untuk render statis. */
export interface DashboardViewState {
  showQr?: boolean;
  showDetail?: boolean;
  /** Index menu yang disorot (0..menuItems().length-1). */
  menuIndex?: number;
  flash?: string | null;
  /** Menunggu tekan kedua untuk aksi yang memutus session running. */
  confirm?: ConfirmAction | null;
  /** Isi input port saat mode "Change port" aktif; null = tidak sedang mengisi. */
  portInput?: string | null;
  portError?: string | null;
}

export type ConfirmAction = "quit" | "background" | "stop" | "foreground";

export interface MenuItem {
  id: "open" | "copy" | "qr" | "detail" | "port" | "background" | "foreground" | "stop" | "quit";
  key: string;
  label: string;
}

export function menuItems(
  view: Pick<DashboardViewState, "showQr" | "showDetail"> = {},
  mode: DashboardMode = "foreground",
): MenuItem[] {
  const common: MenuItem[] = [
    { id: "open", key: "o", label: "Open in browser" },
    { id: "copy", key: "c", label: "Copy URL" },
    { id: "qr", key: "m", label: view.showQr ? "Hide phone QR" : "Show phone QR" },
    {
      id: "detail",
      key: "t",
      label: view.showDetail ? "Hide tunnel detail" : "Tunnel detail",
    },
    { id: "port", key: "p", label: "Change port" },
  ];
  if (mode === "background") {
    return [
      ...common,
      { id: "foreground", key: "f", label: "Run in foreground" },
      { id: "stop", key: "s", label: "Stop server" },
      { id: "quit", key: "q", label: "Close dashboard" },
    ];
  }
  return [
    ...common,
    { id: "background", key: "b", label: "Run in background" },
    { id: "quit", key: "q", label: "Quit" },
  ];
}

/** URL tanpa skema — lebih ringkas untuk hint menu. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** Deskripsi kanan tiap item menu. */
export function menuHint(id: MenuItem["id"], snap: DashboardSnapshot): string {
  const running = snap.running;
  if (id === "open") return shortUrl(snap.localUrl);
  if (id === "copy") return `${snap.target.label} URL`;
  if (id === "qr") return "scan from your phone";
  if (id === "detail") return snap.tunnel.text;
  if (id === "port") return `current ${snap.port}`;
  if (id === "background") return "keeps running after terminal closes";
  if (id === "foreground") return "move the server into this terminal";
  if (id === "stop")
    return running > 0 ? `stop server · ${running} running` : "stop the background server";
  if (snap.mode === "background") return "server keeps running";
  return running > 0 ? `stop server · ${running} running` : "stop server & exit";
}

const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;

export const CONFIRM_TEXT: Record<ConfirmAction, (n: number) => string> = {
  quit: (n) => `! ${plural(n)} running — press q again to stop`,
  stop: (n) => `! ${plural(n)} running — press s again to stop`,
  background: (n) => `! ${plural(n)} running will be interrupted — press b again`,
  foreground: (n) => `! ${plural(n)} running will be interrupted — press f again`,
};

/** Validasi isi input port; null = valid. */
export function portInputError(raw: string): string | null {
  if (raw === "") return "Enter a port number";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return "Port must be between 1 and 65535";
  if (n < 1024) return "Ports below 1024 need root — pick 1024 or higher";
  return null;
}
