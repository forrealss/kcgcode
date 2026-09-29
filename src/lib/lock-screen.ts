/**
 * Logika murni lock screen (tanpa DOM) — dipisah agar dapat diuji `bun test`.
 */

export const PIN_MAX = 12;

export type PinKeyAction =
  | { type: "digit"; digit: string }
  | { type: "backspace" }
  | { type: "submit" }
  | { type: "clear" };

/**
 * Terjemahkan tombol keyboard fisik menjadi aksi PIN. Angka baris atas
 * menghasilkan `key` "0"-"9". Numpad dibaca dari `code` (`Numpad0`-`Numpad9`)
 * agar tetap jalan walau NumLock mati (saat itu `key` berisi panah/Home/End).
 * Kombinasi dengan Ctrl/Cmd/Alt diabaikan agar pintasan browser tetap jalan.
 */
export function pinKeyAction(e: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): PinKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (/^[0-9]$/.test(e.key)) return { type: "digit", digit: e.key };
  const numpad = /^Numpad([0-9])$/.exec(e.code ?? "");
  if (numpad?.[1]) return { type: "digit", digit: numpad[1] };
  if (e.key === "Backspace" || e.key === "Delete") return { type: "backspace" };
  // `NumpadEnter` juga ber-key "Enter".
  if (e.key === "Enter") return { type: "submit" };
  if (e.key === "Escape") return { type: "clear" };
  return null;
}

/** Terapkan aksi ke PIN saat ini (batas panjang dijaga). */
export function applyPinAction(pin: string, action: PinKeyAction): string {
  switch (action.type) {
    case "digit":
      return pin.length >= PIN_MAX ? pin : pin + action.digit;
    case "backspace":
      return pin.slice(0, -1);
    case "clear":
      return "";
    case "submit":
      return pin;
  }
}

/** Ambil angka dari teks tempelan (mis. "48 29 15" -> "482915"). */
export function digitsFromPaste(text: string, current: string): string {
  return (current + text.replace(/\D/g, "")).slice(0, PIN_MAX);
}
