/** Baris kolom PIN/password berlabel di dialog kunci Settings -> Security. */
import { useId, useRef } from "react";
import { SecretInput } from "@/components/auth/SecretInput";
import { useDelayedFocus } from "@/hooks/useDelayedFocus";
import type { LockKind } from "@/lib/lock-secret";

export function SecretField({
  label,
  kind,
  value,
  onChange,
  autoComplete,
  autoFocus = false,
  hint,
}: {
  label: string;
  kind: LockKind;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  // Tunggu animasi buka dialog agar fokus tidak dicuri kembali.
  useDelayedFocus(ref, 50, { enabled: autoFocus });
  return (
    <li className="flex flex-col px-4 py-2 focus-within:bg-muted/30">
      <label htmlFor={id} className="text-[12px] leading-4 text-muted-foreground">
        {label}
      </label>
      <SecretInput
        ref={ref}
        id={id}
        kind={kind}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-7"
      />
      {hint && (
        <span id={`${id}-hint`} className="sr-only">
          {hint}
        </span>
      )}
    </li>
  );
}
