/** Lock screen: tampilan buka kunci dengan passkey (tombol sidik jari besar). */
import { FingerprintIcon, KeyboardIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Mode passkey: satu tombol bundar besar (target sentuh 96px+) dengan cincin
 * yang berdenyut pelan saat menunggu perangkat. Enter / Space juga memicu.
 */
export function PasskeyEntry({
  busy,
  disabled,
  message,
  secretLabel,
  onUnlock,
  onUseSecret,
}: {
  busy: boolean;
  disabled: boolean;
  message: string | null;
  secretLabel: string;
  onUnlock: () => void;
  onUseSecret: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Fokus ke tombol: Enter langsung memicu passkey dari keyboard.
  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={onUnlock}
        disabled={disabled}
        aria-busy={busy}
        aria-describedby="lock-passkey-status"
        className="group relative flex size-28 items-center justify-center rounded-full outline-none disabled:cursor-not-allowed [@media(min-height:760px)]:size-32"
      >
        {/* Cincin luar: berdenyut saat menunggu konfirmasi di perangkat. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full border-2 border-primary/25 transition-colors",
            busy && "animate-ping border-primary/40 motion-reduce:animate-none",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "flex size-full items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-[transform,opacity] duration-150",
            "group-hover:scale-[1.03] group-active:scale-95 group-focus-visible:ring-[4px] group-focus-visible:ring-ring/50 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background",
            disabled && !busy && "opacity-40",
          )}
        >
          {busy ? (
            <Spinner className="size-9" />
          ) : (
            <FingerprintIcon className="size-12" strokeWidth={1.6} />
          )}
        </span>
        <span className="sr-only">{busy ? "Waiting for your passkey" : "Unlock with passkey"}</span>
      </button>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-[15px] font-medium">
          {busy ? "Confirm on your device…" : "Unlock with passkey"}
        </p>
        <p
          id="lock-passkey-status"
          aria-live="polite"
          className={cn(
            "min-h-5 max-w-xs text-sm",
            message ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message ?? (busy ? "Use your fingerprint, face, or screen lock." : "Tap to continue")}
        </p>
      </div>

      <button
        type="button"
        onClick={onUseSecret}
        disabled={busy}
        className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
      >
        <KeyboardIcon className="size-4" aria-hidden />
        Use {secretLabel} instead
      </button>
    </div>
  );
}
