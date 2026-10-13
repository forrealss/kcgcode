/**
 * Status instalasi PWA di sisi browser.
 *
 * - PWA terikat ke origin: alamat localhost.run (`<acak>.lhr.life`) berubah
 *   tiap sambung ulang, jadi app yang di-install dari sana langsung basi.
 *   Origin semacam itu dianggap "sementara" — manifest tidak di-link (Chrome
 *   tidak menawarkan Install) dan UI mengarahkan ke KCG Code link.
 * - `beforeinstallprompt` bisa terpicu sebelum React mount, jadi listener
 *   dipasang sekali saat modul dimuat (`frontend.tsx`) dan event disimpan
 *   untuk dipicu belakangan dari tombol Install.
 */
import { useSyncExternalStore } from "react";

const EPHEMERAL_HOST_RE = /(^|\.)(lhr\.life|localhost\.run)$/i;

/** Host tunnel gratis yang alamatnya berganti-ganti (tak layak di-install). */
export function isEphemeralHost(hostname: string): boolean {
  return EPHEMERAL_HOST_RE.test(hostname);
}

/** Sedang berjalan sebagai app ter-install (tanpa address bar browser). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iOS/iPadOS: tidak punya `beforeinstallprompt`, install manual lewat Share. */
export function isIOS(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  // iPadOS 13+ mengaku sebagai Mac desktop; bedakan lewat layar sentuh.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Pasang listener install sedini mungkin (dipanggil sekali dari entry). */
export function captureInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Tahan mini-infobar bawaan Chrome; tawaran install lewat UI kita sendiri.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** Tampilkan dialog install bawaan browser. `true` bila user menyetujui. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  // Event hanya bisa dipakai sekali.
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}

export interface InstallState {
  /** Browser siap menampilkan dialog install (Chrome/Edge/Samsung Internet). */
  canPrompt: boolean;
  /** App baru saja di-install dari tab ini. */
  installed: boolean;
}

let snapshot: InstallState = { canPrompt: false, installed: false };

function getSnapshot(): InstallState {
  if (snapshot.canPrompt !== (deferred !== null) || snapshot.installed !== installed) {
    snapshot = { canPrompt: deferred !== null, installed };
  }
  return snapshot;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const SERVER_SNAPSHOT: InstallState = { canPrompt: false, installed: false };

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
