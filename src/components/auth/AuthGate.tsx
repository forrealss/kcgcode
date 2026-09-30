/**
 * Gerbang kunci aplikasi. Selama kunci aktif dan sesi belum dibuka, app TIDAK
 * dirender sama sekali — tidak ada request API / WebSocket yang berjalan dan
 * tidak ada data yang tersisa di DOM. Yang tampil hanya `LockScreen`.
 *
 * Animasi (Motion `AnimatePresence`, `initial={false}` -> tidak beranimasi
 * saat app pertama dibuka dalam keadaan terkunci):
 * - Dikunci: lock screen turun dari atas. App lama ditahan di DOM (inert)
 *   hanya sampai lock screen mendarat, lalu dilepas.
 * - Dibuka: lock screen naik keluar layar, app sudah ada di bawahnya.
 *
 * Kunci otomatis: server menegakkan batas idle; klien menirunya dengan timer
 * aktivitas lokal (agar layar terkunci tepat waktu walau tidak ada request)
 * dan heartbeat status berkala (mendeteksi kunci dari perangkat lain /
 * sesi dicabut).
 */
import { AnimatePresence, useIsPresent, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useEffect, useRef } from "react";
import { LockScreen } from "@/components/auth/LockScreen";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { lockNow, refreshAuth, useAuth } from "@/lib/auth";

/** Interval cek status ke server saat app terbuka. */
const HEARTBEAT_MS = 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    void refreshAuth();
  }, []);

  const status = auth.phase === "ready" ? auth.status : null;
  const unlocked = status !== null && (!status.protected || status.authenticated);
  const autoLockMs =
    status?.protected && status.autoLockMinutes > 0 ? status.autoLockMinutes * 60_000 : 0;

  // Kunci otomatis sisi klien + heartbeat.
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!unlocked || !status?.protected) return;
    lastActivity.current = Date.now();
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });

    const tick = setInterval(() => {
      if (autoLockMs > 0 && Date.now() - lastActivity.current >= autoLockMs) {
        void lockNow();
      }
    }, 5_000);
    const heartbeat = setInterval(() => void refreshAuth(), HEARTBEAT_MS);
    // Kembali ke tab / buka app lagi di HP -> cek segera (timer bisa tertunda
    // saat tab di latar belakang).
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (autoLockMs > 0 && Date.now() - lastActivity.current >= autoLockMs) void lockNow();
      else void refreshAuth();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
      clearInterval(tick);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [unlocked, status?.protected, autoLockMs]);

  if (auth.phase === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-background" role="status">
        <Spinner className="size-6 text-muted-foreground" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (auth.phase === "error") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">Can't reach the KCG Code server.</p>
        <Button type="button" variant="outline" onClick={() => void refreshAuth()}>
          Try again
        </Button>
      </div>
    );
  }

  const locked = !unlocked && status !== null;
  return (
    <AnimatePresence initial={false}>
      {locked ? (
        <m.div
          key="lock"
          // Tirai: turun dari atas saat dikunci, naik keluar saat dibuka.
          // Bayangan di tepi bawah hanya terlihat selama bergerak.
          className="fixed inset-0 z-[100] shadow-[0_24px_48px_-12px_rgb(0_0_0/0.45)]"
          initial={{ y: "-100%" }}
          animate={{ y: 0, transition: { duration: 0.55, ease: LOCK_EASE } }}
          exit={{ y: "-100%", transition: { duration: 0.45, ease: LOCK_EASE } }}
        >
          <LockScreen status={status} />
        </m.div>
      ) : (
        <AppLayer key="app">{children}</AppLayer>
      )}
    </AnimatePresence>
  );
}

/** Kurva ala sheet iOS: cepat di awal, mendarat halus. */
const LOCK_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
/** Selama app lama ditahan di bawah lock screen yang sedang turun (detik). */
const LOCK_COVER_S = 0.55;

/**
 * App yang sedang terbuka. Saat dikunci, `AnimatePresence` menahannya di DOM
 * sampai lock screen selesai menutupi layar (`exit` tertunda
 * `LOCK_COVER_S`), lalu melepasnya — tidak ada data yang tersisa. Selama
 * ditahan: `inert` (tak bisa diklik, difokus, atau dibaca pembaca layar).
 * `display: contents` agar pembungkus tidak mengubah layout shell.
 */
function AppLayer({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  // Reduced motion: lock screen tampil seketika, jadi app tak perlu ditahan.
  const reduced = useReducedMotion();
  return (
    <m.div
      className="contents"
      inert={!present}
      exit={{ opacity: 0, transition: { delay: reduced ? 0 : LOCK_COVER_S, duration: 0 } }}
    >
      {children}
    </m.div>
  );
}
