/**
 * Tawaran memasang KCG Code sebagai app (PWA) di HP — dipakai
 * `InstallAppDialog`, dan oleh `AppShell` untuk menahan dialog update selama
 * tawaran ini masih berlaku (dialog install didahulukan di HP).
 *
 * "Not now" menunda tawaran `INSTALL_SNOOZE_MS` (diingat di localStorage).
 */
import { useState } from "react";
import { type InstallOfferKind, installOfferKind, isStandalone, useInstallState } from "@/lib/pwa";

const SNOOZE_KEY = "kcg-install-dialog-snoozed-at";
export const INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export function isInstallSnoozed(snoozedAt: number | null, now: number): boolean {
  return snoozedAt !== null && now - snoozedAt < INSTALL_SNOOZE_MS;
}

function readSnoozedAt(): number | null {
  try {
    const n = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export interface InstallOffer {
  /** null = jangan tawarkan (lihat `installOfferKind`, atau sedang ditunda). */
  kind: InstallOfferKind | null;
  /** "Not now": tunda tawaran. */
  snooze(): void;
}

export function useInstallOffer(): InstallOffer {
  const { canPrompt, installed } = useInstallState();
  const [snoozedAt, setSnoozedAt] = useState(readSnoozedAt);
  const kind = isInstallSnoozed(snoozedAt, Date.now())
    ? null
    : installOfferKind({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        hostname: window.location.hostname,
        standalone: isStandalone(),
        installed,
        canPrompt,
      });

  return {
    kind,
    snooze() {
      const now = Date.now();
      setSnoozedAt(now);
      try {
        localStorage.setItem(SNOOZE_KEY, String(now));
      } catch {
        /* tetap ditunda untuk tab ini */
      }
    },
  };
}
