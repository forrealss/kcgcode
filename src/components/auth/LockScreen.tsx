/**
 * Lock screen — menutupi seluruh app saat kunci aktif dan sesi belum dibuka.
 *
 * Tampilan ala lock screen: jam & tanggal, foto profil, nickname, lalu input
 * sesuai jenis kunci:
 * - PIN: titik indikator + keypad. Keyboard fisik didengar di level window
 *   (angka baris atas / numpad, Backspace, Enter, Esc) sehingga tidak perlu
 *   klik apa pun dulu. Tombol keypad sengaja tidak menyala saat mengetik
 *   dari keyboard (tidak membocorkan angka saat layar dibagikan). Tempel
 *   (paste) juga didukung. Panjang PIN tidak diketahui klien, jadi dikirim dengan
 *   Enter / tombol ✓.
 * - Password: kartu dengan kolom sandi besar, tombol tampilkan, indikator
 *   Caps Lock, dan tombol "Unlock" penuh.
 * Salah -> getar; terlalu banyak percobaan -> hitung mundur dari server.
 *
 * Aksesibilitas: dialog modal (`role="dialog"`, `aria-modal`), status
 * diumumkan lewat `aria-live`.
 */
import {
  ArrowRightIcon,
  CornerDownLeftIcon,
  DeleteIcon,
  EyeIcon,
  EyeOffIcon,
  KeyboardIcon,
  LockIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/auth/ProfileAvatar";
import { Spinner } from "@/components/ui/spinner";
import { refreshAuth } from "@/lib/auth";
import { applyPinAction, digitsFromPaste, pinKeyAction } from "@/lib/lock-screen";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";

export function LockScreen({ status }: { status: AuthStatus }) {
  const kind = status.lockKind ?? "password";
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [retryUntil, setRetryUntil] = useState<number>(() =>
    status.retryAfterSec > 0 ? Date.now() + status.retryAfterSec * 1000 : 0,
  );
  const [now, setNow] = useState(() => Date.now());

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

  const time = new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const date = new Date(now).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const name = status.profile.nickname;
  const message = blocked ? `Too many attempts. Try again in ${waitSec}s.` : error;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-[100] flex flex-col items-center overflow-y-auto bg-background"
    >
      <div className="relative flex w-full max-w-sm flex-1 flex-col items-center px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-5xl font-light tabular-nums tracking-tight sm:text-6xl">{time}</p>
          <p className="text-sm text-muted-foreground">{date}</p>
        </div>

        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <ProfileAvatar
            nickname={name}
            avatarUrl={status.profile.avatarUrl}
            avatarPreset={status.profile.avatarPreset}
            className="size-24 shadow-lg ring-4 ring-background"
            textClassName="text-3xl"
          />
          <h1 id="lock-title" className="text-xl font-semibold tracking-tight">
            {name ? `Welcome back, ${name}` : "KCG Code is locked"}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LockIcon className="size-3.5" aria-hidden />
            {kind === "pin" ? "Enter your PIN to unlock" : "Enter your password to unlock"}
          </p>
        </div>

        <div className={cn("mt-8 w-full", shake && "animate-[lock-shake_0.45s]")}>
          {kind === "pin" ? (
            <PinEntry
              value={secret}
              onChange={(v) => {
                setError(null);
                setSecret(v);
              }}
              onSubmit={() => void submit(secret)}
              disabled={busy || blocked}
              busy={busy}
              error={shake}
              message={message}
            />
          ) : (
            <PasswordEntry
              value={secret}
              onChange={(v) => {
                setError(null);
                setSecret(v);
              }}
              onSubmit={() => void submit(secret)}
              disabled={busy || blocked}
              busy={busy}
              message={message}
              invalid={Boolean(error)}
            />
          )}
        </div>

        <p className="mt-auto pt-8 text-center text-xs text-muted-foreground/80">
          Forgot it? Run <code className="font-mono">kcgcode reset-lock</code> on the host machine.
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ PIN ----

function PinEntry({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  error,
  message,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
  error: boolean;
  message: string | null;
}) {
  // Nilai terbaru untuk handler window (tanpa memasang ulang listener).
  const latest = useRef({ value, disabled, onChange, onSubmit });
  latest.current = { value, disabled, onChange, onSubmit };

  // Keyboard fisik: didengar di window, jadi langsung bisa mengetik tanpa
  // fokus ke elemen tertentu. Sengaja TIDAK menyalakan tombol keypad yang
  // sesuai: saat layar dibagikan / diintip, itu akan membocorkan angka PIN.
  // Umpan balik cukup lewat titik indikator.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Jangan ganggu kolom input lain (tidak ada di lock screen, defensif).
      if (t && t.tagName === "INPUT" && t.dataset.pinInput === undefined) return;
      const action = pinKeyAction(e);
      if (!action) return;
      // Tombol keypad yang sedang fokus: biarkan Enter/Space mengaktifkan
      // tombol itu sendiri (navigasi Tab tetap berfungsi).
      if (action.type === "submit" && t?.tagName === "BUTTON") return;
      e.preventDefault();
      const cur = latest.current;
      if (cur.disabled) return;
      if (action.type === "submit") {
        cur.onSubmit();
        return;
      }
      cur.onChange(applyPinAction(cur.value, action));
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (!/\d/.test(text)) return;
      e.preventDefault();
      const cur = latest.current;
      if (!cur.disabled) cur.onChange(digitsFromPaste(text, cur.value));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  const press = (d: string) => {
    if (disabled) return;
    onChange(applyPinAction(value, { type: "digit", digit: d }));
  };

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Ringkasan untuk pembaca layar (titik bersifat visual) */}
      <p className="sr-only" aria-live="polite">
        {value.length === 0 ? "No digits entered" : `${value.length} digits entered`}
      </p>
      <PinDots length={value.length} error={error} />

      <p
        aria-live="polite"
        className={cn(
          "min-h-5 text-center text-sm",
          message ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {message ?? ""}
      </p>

      <PinPad
        disabled={disabled}
        canSubmit={value.length > 0}
        busy={busy}
        onDigit={press}
        onBackspace={() => onChange(applyPinAction(value, { type: "backspace" }))}
        onSubmit={onSubmit}
      />

      <p className="hidden items-center gap-1.5 text-xs text-muted-foreground pointer-fine:flex">
        <KeyboardIcon className="size-3.5" aria-hidden />
        Type your PIN, then press
        <kbd className="inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-px font-mono text-[11px]">
          <CornerDownLeftIcon className="size-3" aria-hidden />
          Enter
        </kbd>
      </p>
    </div>
  );
}

function PinDots({ length, error }: { length: number; error: boolean }) {
  // Minimal 6 slot (panjang PIN minimum); bertambah bila PIN lebih panjang.
  const slots = Math.max(6, length);
  return (
    <div className="flex h-4 items-center gap-3" aria-hidden>
      {Array.from({ length: slots }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: slot statis
          key={i}
          className={cn(
            "size-3 rounded-full border-2 transition-all duration-150",
            i < length
              ? error
                ? "scale-110 border-destructive bg-destructive"
                : "scale-110 border-foreground bg-foreground"
              : "border-muted-foreground/40",
          )}
        />
      ))}
    </div>
  );
}

function PinPad({
  disabled,
  canSubmit,
  busy,
  onDigit,
  onBackspace,
  onSubmit,
}: {
  disabled: boolean;
  canSubmit: boolean;
  busy: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
}) {
  const key =
    "flex size-[4.5rem] items-center justify-center rounded-full text-2xl font-medium tabular-nums transition-[background-color,transform] duration-100 select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40";
  const digitKey = "bg-muted/70 hover:bg-muted active:scale-95 active:bg-accent";
  return (
    <fieldset className="grid grid-cols-3 gap-x-6 gap-y-4 border-0 p-0" aria-label="PIN keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button
          key={d}
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => onDigit(d)}
          className={cn(key, digitKey)}
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={onBackspace}
        aria-label="Delete last digit"
        className={cn(key, "text-muted-foreground hover:text-foreground active:scale-95")}
      >
        <DeleteIcon className="size-6" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => onDigit("0")}
        className={cn(key, digitKey)}
      >
        0
      </button>
      <button
        type="button"
        disabled={disabled || !canSubmit}
        onClick={onSubmit}
        aria-label="Unlock"
        className={cn(
          key,
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95",
        )}
      >
        {busy ? <Spinner className="size-6" /> : <ArrowRightIcon className="size-6" />}
      </button>
    </fieldset>
  );
}

// ------------------------------------------------------------- password ----

function PasswordEntry({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  message,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
  message: string | null;
  invalid: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fokus otomatis (termasuk setelah jeda rate limit selesai / sandi salah).
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const trackCaps = (e: React.KeyboardEvent | React.MouseEvent) => {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3"
    >
      <div
        className={cn(
          "group relative flex items-center rounded-2xl border bg-card shadow-sm transition-[border-color,box-shadow]",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40",
          invalid &&
            "border-destructive/60 focus-within:border-destructive focus-within:ring-destructive/20",
          disabled && "opacity-60",
        )}
      >
        <LockIcon
          className="pointer-events-none absolute left-4 size-4 text-muted-foreground transition-colors group-focus-within:text-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type={reveal ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Password"
          aria-invalid={invalid || undefined}
          aria-describedby="lock-password-status"
          placeholder="Password"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={trackCaps}
          onKeyUp={trackCaps}
          onMouseDown={trackCaps}
          onBlur={() => setCapsLock(false)}
          className="h-14 w-full min-w-0 rounded-2xl bg-transparent pr-12 pl-11 text-base outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => {
            setReveal((v) => !v);
            inputRef.current?.focus();
          }}
          aria-label={reveal ? "Hide password" : "Show password"}
          aria-pressed={reveal}
          disabled={disabled}
          className="absolute right-2 flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {reveal ? <EyeOffIcon className="size-[18px]" /> : <EyeIcon className="size-[18px]" />}
        </button>
      </div>

      <div id="lock-password-status" aria-live="polite" className="min-h-5 px-1 text-sm">
        {message ? (
          <p className="text-destructive">{message}</p>
        ) : capsLock ? (
          <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="size-3.5" aria-hidden />
            Caps Lock is on
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={disabled || value === ""}
        className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-medium text-primary-foreground shadow-sm transition-[opacity,transform] outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? (
          <>
            <Spinner className="size-4" />
            Unlocking…
          </>
        ) : (
          <>
            Unlock
            <ArrowRightIcon className="size-4" aria-hidden />
          </>
        )}
      </button>
    </form>
  );
}
