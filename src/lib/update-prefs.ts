/**
 * Kabar versi baru yang sudah ditutup di perangkat ini — diingat per versi
 * (localStorage), jadi rilis berikutnya tetap muncul lagi.
 *
 * - `banner`: banner di footer sidebar (pengingat tetap, ditutup dengan ×).
 * - `dialog`: dialog yang muncul sekali per versi saat app dibuka.
 */
import type { UpdateInfo } from "@/server/services/update-check";

export type UpdateNoticeKind = "banner" | "dialog";

const KEYS: Record<UpdateNoticeKind, string> = {
  banner: "kcg-update-dismissed",
  dialog: "kcg-update-dialog-seen",
};

export function readDismissedUpdate(kind: UpdateNoticeKind): string | null {
  try {
    return localStorage.getItem(KEYS[kind]);
  } catch {
    return null;
  }
}

export function dismissUpdate(kind: UpdateNoticeKind, version: string): void {
  try {
    localStorage.setItem(KEYS[kind], version);
  } catch {
    /* tetap tertutup untuk tab ini (state komponen) */
  }
}

/**
 * Dialog update layak dibuka: ada update, versinya belum pernah ditutup, dan
 * pengguna tidak sedang di halaman yang tak boleh disela (`suppressed`).
 */
export function shouldOfferUpdateDialog(
  update: UpdateInfo | null | undefined,
  seenVersion: string | null,
  suppressed: boolean,
): update is UpdateInfo {
  return !!update && update.latest !== seenVersion && !suppressed;
}
