/**
 * State & aksi buka kunci lock screen: kunci yang sedang diketik, kirim ke
 * server, passkey, getar saat salah, dan hitung mundur rate limit dari
 * server. Tampilan ada di `LockScreen.tsx`.
 */
import { useCallback, useEffect, useState } from "react";
import { refreshAuth } from "@/lib/auth";
import { getPasskeyAvailability, passkeysSupportedHere, unlockWithPasskey } from "@/lib/passkeys";
import type { AuthStatus } from "@/server/services/auth";

export function useUnlock(status: AuthStatus) {
  const kind = status.lockKind ?? "password";
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [retryUntil, setRetryUntil] = useState<number>(() =>
    status.retryAfterSec > 0 ? Date.now() + status.retryAfterSec * 1000 : 0,
  );
  const [now, setNow] = useState(() => Date.now());
  /** Alamat ini punya passkey & browser mendukung (diketahui setelah mount). */
  const [passkeyReady, setPasskeyReady] = useState(false);
  /** Mode input: passkey jadi utama bila tersedia; user bisa beralih. */
  const [mode, setMode] = useState<"passkey" | "secret">("secret");
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  useEffect(() => {
    if (!passkeysSupportedHere()) return;
    let cancelled = false;
    void getPasskeyAvailability()
      .then((a) => {
        if (cancelled || !a.supported || a.count === 0) return;
        setPasskeyReady(true);
        setMode("passkey");
      })
      .catch(() => {
        // Gagal cek -> tetap PIN/password.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Jam (dan hitung mundur rate limit).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const waitSec = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const blocked = waitSec > 0;

  const fail = useCallback((message: string) => {
    setError(message);
    setSecret("");
    setShake(true);
    setTimeout(() => setShake(false), 450);
    navigator.vibrate?.(120);
  }, []);

  const submit = useCallback(
    async (value: string) => {
      if (busy || blocked || value === "") return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret: value }),
        });
        if (res.ok) {
          setSecret("");
          await refreshAuth();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          retryAfterSec?: number;
        };
        if (res.status === 429) {
          const sec = body.retryAfterSec ?? Number(res.headers.get("retry-after") ?? 30);
          setRetryUntil(Date.now() + sec * 1000);
          fail("Too many attempts.");
        } else if (body.error === "AUTH_NOT_CONFIGURED") {
          await refreshAuth();
        } else {
          fail(kind === "pin" ? "Wrong PIN. Try again." : "Wrong password. Try again.");
        }
      } catch {
        setError("Can't reach KCG Code. Check your connection.");
      } finally {
        setBusy(false);
      }
    },
    [busy, blocked, kind, fail],
  );

  const unlockPasskey = useCallback(async () => {
    if (passkeyBusy || blocked) return;
    setPasskeyBusy(true);
    setError(null);
    const res = await unlockWithPasskey();
    if (res.ok) {
      await refreshAuth();
      setPasskeyBusy(false);
      return;
    }
    setPasskeyBusy(false);
    // Menutup dialog sistem bukan kesalahan — diam saja.
    if (res.cancelled) return;
    if (res.code === "AUTH_RATE_LIMITED") {
      // Detik tunggu dibaca dari status server (sumber yang sama dgn PIN).
      try {
        const st = (await (await fetch("/api/auth/status")).json()) as AuthStatus;
        setRetryUntil(Date.now() + Math.max(1, st.retryAfterSec) * 1000);
      } catch {
        setRetryUntil(Date.now() + 30_000);
      }
      fail("Too many attempts.");
      return;
    }
    fail(res.message);
  }, [passkeyBusy, blocked, fail]);

  /** Ketikan baru (keypad / keyboard / kolom sandi): hapus pesan error lama. */
  const editSecret = (v: string) => {
    setError(null);
    setSecret(v);
  };

  /** Beralih dari passkey ke PIN/password. */
  const showSecret = () => {
    setError(null);
    setMode("secret");
  };

  /** Beralih kembali ke passkey (kunci yang setengah diketik dibuang). */
  const showPasskey = () => {
    setError(null);
    setSecret("");
    setMode("passkey");
  };

  return {
    kind,
    secret,
    busy,
    error,
    shake,
    now,
    blocked,
    /** Pesan status: hitung mundur rate limit didahulukan dari error biasa. */
    message: blocked ? `Too many attempts. Try again in ${waitSec}s.` : error,
    mode,
    passkeyReady,
    passkeyBusy,
    editSecret,
    showSecret,
    showPasskey,
    submit,
    unlockPasskey,
  };
}
