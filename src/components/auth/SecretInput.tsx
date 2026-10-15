/**
 * Kolom PIN/password bersama (welcome screen, Settings -> Security, dialog
 * passkey & workspace): selalu `type="password"`, keypad angka + hanya digit
 * untuk PIN, batas panjang mengikuti jenis kunci. Label, baris pembungkus,
 * dan tinggi kolom (lewat `className`) tetap milik pemanggil.
 */
import type { Ref } from "react";
import { type LockKind, sanitizeSecretInput, secretMaxLength } from "@/lib/lock-secret";
import { cn } from "@/lib/utils";

export function SecretInput({
  ref,
  id,
  kind,
  value,
  onChange,
  autoComplete,
  disabled,
  className,
  "aria-describedby": describedBy,
}: {
  ref?: Ref<HTMLInputElement>;
  id: string;
  kind: LockKind;
  value: string;
  /** Menerima nilai yang sudah dibersihkan (PIN: hanya angka). */
  onChange: (value: string) => void;
  autoComplete: string;
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
}) {
  return (
    <input
      ref={ref}
      id={id}
      type="password"
      inputMode={kind === "pin" ? "numeric" : undefined}
      autoComplete={autoComplete}
      maxLength={secretMaxLength(kind)}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(sanitizeSecretInput(kind, e.target.value))}
      aria-describedby={describedBy}
      className={cn(
        // 16px di mobile: iOS Safari men-zoom halaman saat fokus ke input < 16px.
        "w-full bg-transparent text-base outline-none sm:text-[15px]",
        kind === "pin" && "tracking-[0.3em]",
        className,
      )}
    />
  );
}
