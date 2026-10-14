/**
 * Dashboard terminal live untuk server kcgcode — dirender lewat Ink.
 *
 * Alternate screen + frame update in-place; layout modern dengan card.
 */
import { render, useInput } from "ink";
import { InkReact } from "../ink-react";
import { readPackageVersion } from "../theme";
import { DashboardUI, renderSnapshot } from "./DashboardUI";
import { type ConfirmAction, menuItems, portInputError, shortUrl } from "./menu";
import type { DashboardSnapshot } from "./snapshot";
import { copyToClipboard } from "./system";

// Hook wajib dari instance React milik Ink — lihat ink-react.ts.
const { useEffect, useReducer, useRef, useState } = InkReact;

export interface DashboardCallbacks {
  /** q / Ctrl+C. Foreground: hentikan server. Background: tutup dashboard saja. */
  onQuit: (reason: string) => void;
  /** Buka URL dashboard di browser default. */
  onOpenUrl: () => void | Promise<void>;
  /** Simpan port ke config & restart server. Resolve null = sukses, string = error. */
  onChangePort: (port: number) => Promise<string | null>;
  /** Foreground: pindahkan server ke background (daemon) lalu keluar. */
  onBackground: () => void;
  /** Background: hentikan daemon. */
  onStop: () => void;
  /** Background: hentikan daemon lalu jalankan server di terminal ini. */
  onForeground: () => void;
}

const REFRESH_MS = 1000;
const FLASH_MS = 2500;
const CONFIRM_MS = 3000;

/** Sumber data dashboard — dibaca ulang setiap render. */
export type SnapshotSource = () => DashboardSnapshot;

interface DashboardAppProps {
  source: SnapshotSource;
  version: string;
  callbacks: DashboardCallbacks;
}

function DashboardApp({ source, version, callbacks }: DashboardAppProps) {
  const { onQuit, onOpenUrl, onChangePort, onBackground, onStop, onForeground } = callbacks;
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const snap = source();
  const background = snap.mode === "background";
  const [showQr, setShowQr] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirmState] = useState<ConfirmAction | null>(null);
  const [portInput, setPortInputState] = useState<string | null>(null);
  // Ink bisa memproses beberapa tombol sebelum re-render; handler membaca ref
  // agar tidak memakai nilai state yang basi.
  const confirmRef = useRef<ConfirmAction | null>(null);
  const portRef = useRef<string | null>(null);
  const setConfirm = (v: ConfirmAction | null) => {
    confirmRef.current = v;
    setConfirmState(v);
  };
  const setPortInput = (v: string | null) => {
    portRef.current = v;
    setPortInputState(v);
  };
  const [portError, setPortError] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      clearInterval(id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const notify = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };

  /**
   * Aksi yang memutus session running (quit / background) butuh tekan kedua
   * dalam CONFIRM_MS. Tanpa session running langsung dijalankan.
   */
  const confirmed = (action: ConfirmAction): boolean => {
    if (source().running === 0 || confirmRef.current === action) {
      setConfirm(null);
      return true;
    }
    setConfirm(action);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), CONFIRM_MS);
    return false;
  };

  const doOpen = () => {
    void onOpenUrl();
    notify(`Opening ${shortUrl(source().localUrl)}…`);
  };
  const doCopy = () => {
    // Tampilkan URL-nya juga: terminal tanpa dukungan OSC 52 tetap bisa disalin manual.
    const t = source().target;
    copyToClipboard(t.url);
    notify(`Copied ${t.url}`);
  };
  const doQuit = () => {
    // Background: q hanya menutup dashboard — tidak ada yang terputus.
    if (background || confirmed("quit")) onQuit("quit");
  };
  const doStop = () => {
    if (confirmed("stop")) onStop();
  };
  const doForeground = () => {
    if (confirmed("foreground")) onForeground();
  };
  const doBackground = () => {
    if (confirmed("background")) onBackground();
  };
  const openPortInput = () => {
    setPortInput(String(source().port));
    setPortError(null);
  };
  const submitPort = async (raw: string) => {
    const err = portInputError(raw);
    if (err) {
      setPortError(err);
      return;
    }
    const next = Number(raw);
    const prev = source().port;
    setPortError(null);
    // onChangePort menyetel status restarting secara sinkron — render segera.
    const pending = onChangePort(next);
    tick();
    const failed = await pending;
    if (failed) {
      setPortError(failed);
      return;
    }
    setPortInput(null);
    notify(next === prev ? `Port ${next} saved to config` : `Server restarted on port ${next}`);
  };

  const activate = (index: number) => {
    const items = menuItems({ showQr, showDetail }, snap.mode);
    const item = items[index];
    if (!item) return;
    if (item.id === "open") doOpen();
    else if (item.id === "copy") doCopy();
    else if (item.id === "qr") setShowQr((v) => !v);
    else if (item.id === "detail") setShowDetail((v) => !v);
    else if (item.id === "port") openPortInput();
    else if (item.id === "background") doBackground();
    else if (item.id === "foreground") doForeground();
    else if (item.id === "stop") doStop();
    else if (item.id === "quit") doQuit();
  };

  /** Mode input port: hanya angka, backspace, enter, esc yang diproses. */
  const handlePortKey = (
    current: string,
    input: string,
    key: Parameters<Parameters<typeof useInput>[0]>[1],
  ) => {
    // Abaikan input selama restart berjalan.
    if (source().restarting) return;
    if (key.escape) {
      setPortInput(null);
      setPortError(null);
    } else if (key.return) {
      void submitPort(current);
    } else if (key.backspace || key.delete) {
      setPortInput(current.slice(0, -1));
      setPortError(null);
    } else {
      const digits = input.replace(/\D/g, "");
      const next = (current + digits).slice(0, 5);
      if (digits) {
        setPortInput(next);
        setPortError(null);
      }
      // Paste "4000⏎" tiba sebagai satu chunk tanpa flag return.
      if (/[\r\n]/.test(input)) void submitPort(next);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onQuit("Ctrl+C");
      return;
    }
    if (portRef.current !== null) {
      handlePortKey(portRef.current, input, key);
      return;
    }
    if (key.escape) {
      if (confirmRef.current) {
        setConfirm(null);
        return;
      }
      if (showQr || showDetail) {
        setShowQr(false);
        setShowDetail(false);
        return;
      }
    }
    const menu = menuItems({}, snap.mode);
    const count = menu.length;
    if (key.upArrow) {
      setMenuIndex((i) => (i + count - 1) % count);
      return;
    }
    if (key.downArrow) {
      setMenuIndex((i) => (i + 1) % count);
      return;
    }
    if (key.return) {
      activate(menuIndex);
      return;
    }
    const k = input.toLowerCase();
    // Shortcut huruf: sorot item terkait lalu jalankan, agar ada umpan balik visual.
    const shortcutIdx = menu.findIndex((item) => item.key === k);
    if (shortcutIdx >= 0) {
      setMenuIndex(shortcutIdx);
      activate(shortcutIdx);
    } else if (k === "j") {
      setMenuIndex((i) => (i + 1) % count);
    } else if (k === "k") {
      setMenuIndex((i) => (i + count - 1) % count);
    } else if (/^[1-9]$/.test(k) && Number(k) <= count) {
      setMenuIndex(Number(k) - 1);
      activate(Number(k) - 1);
    }
  });

  return (
    <DashboardUI
      snap={snap}
      version={version}
      view={{ showQr, showDetail, menuIndex, flash, confirm, portInput, portError }}
    />
  );
}

export interface RunningDashboard {
  stop(): void;
  /** Frame sudah live via Ink; API dipertahankan untuk kompatibilitas. */
  redraw(): void;
}

/**
 * Mulai dashboard live di alternate screen. Kembalikan handle untuk stop.
 * Pastikan `stop()` dipanggil saat shutdown agar terminal pulih.
 */
export async function startDashboard(
  source: SnapshotSource,
  callbacks: Partial<DashboardCallbacks> = {},
): Promise<RunningDashboard> {
  const version = await readPackageVersion();
  const stdout = process.stdout;
  const isTty = Boolean(stdout.isTTY);

  const noop = () => {};
  const cb: DashboardCallbacks = {
    onQuit: callbacks.onQuit ?? noop,
    onOpenUrl: callbacks.onOpenUrl ?? noop,
    onChangePort: callbacks.onChangePort ?? (async () => "not supported"),
    onBackground: callbacks.onBackground ?? noop,
    onStop: callbacks.onStop ?? noop,
    onForeground: callbacks.onForeground ?? noop,
  };

  if (!isTty) {
    stdout.write(`${renderSnapshot(source(), version)}\n`);
    return {
      stop() {},
      redraw() {
        stdout.write(`${renderSnapshot(source(), version)}\n`);
      },
    };
  }

  const instance = render(<DashboardApp source={source} version={version} callbacks={cb} />, {
    alternateScreen: true,
    patchConsole: true,
    exitOnCtrlC: false,
    incrementalRendering: true,
  });

  return {
    stop() {
      instance.unmount();
    },
    redraw() {
      instance.rerender(<DashboardApp source={source} version={version} callbacks={cb} />);
    },
  };
}
