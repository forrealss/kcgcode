/**
 * Pemilih jenis kunci (PIN / Password): segmented control ala GNOME dari
 * radio tersembunyi. Dipakai langkah kunci di welcome screen dan dialog
 * kunci di Settings -> Security.
 */
import type { LockKind } from "@/lib/lock-secret";
import { cn } from "@/lib/utils";

export function LockKindPicker({
  name,
  value,
  onChange,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
}: {
  /** Nama grup radio (unik per formulir). */
  name: string;
  value: LockKind;
  onChange: (kind: LockKind) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <fieldset
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      className="grid grid-cols-2 gap-1 rounded-lg border-0 bg-muted p-1"
    >
      {(["pin", "password"] as const).map((k) => (
        <label
          key={k}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
            value === k
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name={name}
            value={k}
            checked={value === k}
            onChange={() => onChange(k)}
            className="sr-only"
          />
          {k === "pin" ? "PIN" : "Password"}
        </label>
      ))}
    </fieldset>
  );
}
