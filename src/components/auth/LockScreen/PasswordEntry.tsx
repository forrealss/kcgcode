/**
 * Lock screen: input password — kolom sandi besar, tombol tampilkan,
 * indikator Caps Lock, dan tombol "Unlock" penuh.
 */
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function PasswordEntry({
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
