/**
 * Gerbang kunci aplikasi. Selama kunci aktif dan sesi belum dibuka, app TIDAK
 * dirender sama sekali — tidak ada request API / WebSocket yang berjalan dan
 * tidak ada data yang tersisa di DOM. Yang tampil hanya `LockScreen`.
 *
 * Kunci otomatis: server menegakkan batas idle; klien menirunya dengan timer
 * aktivitas lokal (agar layar terkunci tepat waktu walau tidak ada request)
 * dan heartbeat status berkala (mendeteksi kunci dari perangkat lain /
 * sesi dicabut).
 */
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

  if (!unlocked && status) return <LockScreen status={status} />;
  return <>{children}</>;
}
