/**
 * Lock screen: input PIN — titik indikator + keypad, keyboard fisik & tempel
 * didengar di level window (lihat `lib/lock-screen.ts`).
 */
import { ArrowRightIcon, CornerDownLeftIcon, DeleteIcon, KeyboardIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";
import { applyPinAction, digitsFromPaste, pinKeyAction } from "@/lib/lock-screen";
import { cn } from "@/lib/utils";

export function PinEntry({
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
    <div className="flex flex-col items-center gap-4">
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
    "flex size-16 items-center justify-center rounded-full text-2xl [@media(min-height:760px)]:size-[4.5rem] font-medium tabular-nums transition-[background-color,transform] duration-100 select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40";
  const digitKey = "bg-muted/70 hover:bg-muted active:scale-95 active:bg-accent";
  return (
    <fieldset
      className="grid grid-cols-3 gap-x-6 gap-y-3 border-0 p-0 [@media(min-height:760px)]:gap-y-4"
      aria-label="PIN keypad"
    >
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
