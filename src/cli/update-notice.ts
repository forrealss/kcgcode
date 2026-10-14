/**
 * Teks "update tersedia" untuk terminal: dicetak setelah dashboard ditutup,
 * di `kcgcode --version`, dan sebagai baris panel `kcgcode status`.
 *
 * `installed` = versi paket di disk. Bisa lebih baru dari versi server yang
 * berjalan (paket sudah diperbarui, daemon belum di-restart) — pesannya
 * berubah jadi ajakan restart, bukan perintah install lagi.
 */
import { isUpdateInstalled, type UpdateInfo } from "../server/services/update-check";
import { c, symbols } from "./theme";

/** Isi baris "Update" (tanpa label) untuk panel status. */
export function updateRowText(update: UpdateInfo, installed?: string): string {
  if (installed && isUpdateInstalled(update, installed)) {
    return `${c.greenBright(`v${update.latest}`)} ${c.dim("installed · restart to apply")}`;
  }
  return `${c.yellowBright(`v${update.latest}`)} ${c.dim("available ·")} ${c.cyan(update.command)}`;
}

/** Satu baris notifikasi update yang berdiri sendiri. */
export function updateNotice(update: UpdateInfo, installed?: string): string {
  if (installed && isUpdateInstalled(update, installed)) {
    return `${c.yellow(symbols.warn)} KCG Code ${c.greenBright(`v${update.latest}`)} is installed ${c.dim("— restart kcgcode to use it.")}`;
  }
  return `${c.yellow(symbols.warn)} Update available ${c.dim(`v${update.current} →`)} ${c.greenBright(`v${update.latest}`)}${c.dim(" · run")} ${c.cyan(update.command)}`;
}
