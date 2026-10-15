/**
 * Dikte suara (speech-to-text) di composer — logika murni + preferensi bahasa
 * per perangkat. Alur (mic, timer hening, kirim otomatis) ada di
 * `hooks/useSpeechToText.ts`; tampilan di `components/sessions/VoiceInput.tsx`.
 *
 * Mesin: Web Speech API bawaan browser (`SpeechRecognition` /
 * `webkitSpeechRecognition`) — Chrome, Edge, Safari; Firefox belum punya.
 * Hanya di secure context (HTTPS / localhost), sama seperti push
 * (`lib/push.ts`). Di Chrome audio diproses server Google.
 *
 * TypeScript (lib.dom) hanya punya tipe event-nya, bukan `SpeechRecognition`
 * itu sendiri — antarmuka minimal yang dipakai didefinisikan di sini.
 */
import { useSyncExternalStore } from "react";

// ------------------------------------------------------------ dukungan ----

export type SpeechSupport =
  | "supported"
  /** HTTP biasa (bukan HTTPS / localhost) — mic diblokir browser. */
  | "insecure"
  /** Browser tanpa Web Speech API (mis. Firefox). */
  | "unsupported";

export interface SpeechEnv {
  secure: boolean;
  hasRecognition: boolean;
}

/** Logika murni (teruji) — lihat `speechSupport()` untuk nilai nyata. */
export function resolveSpeechSupport(env: SpeechEnv): SpeechSupport {
  if (!env.secure) return "insecure";
  if (!env.hasRecognition) return "unsupported";
  return "supported";
}

/** Bagian `SpeechRecognition` yang dipakai aplikasi. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupport(): SpeechSupport {
  if (typeof window === "undefined") return "unsupported";
  return resolveSpeechSupport({
    secure: window.isSecureContext,
    hasRecognition: recognitionCtor() !== null,
  });
}

/** Pesan untuk kode error `SpeechRecognitionErrorEvent`; null = diam saja. */
export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow it for this site in your browser settings.";
    case "audio-capture":
      return "No microphone was found on this device.";
    case "network":
      return "Voice input needs an internet connection.";
    case "language-not-supported":
      return "This browser can't recognize the selected voice input language.";
    default:
      return "Voice input stopped unexpectedly. Try again.";
  }
}

// ------------------------------------------------------------ transkrip ----

/**
 * Teks di input selama dikte: teks yang sudah diketik (`base`) + ucapan
 * (hasil final lalu sementara). Spasi dirapikan — Chrome memberi spasi di
 * depan potongan berikutnya.
 */
export function mergeDictation(base: string, finals: string, interim: string): string {
  const spoken = `${finals} ${interim}`.replace(/\s+/g, " ").trim();
  if (spoken === "") return base;
  if (base === "" || /\s$/.test(base)) return base + spoken;
  return `${base} ${spoken}`;
}

/** Rentang frekuensi suara manusia yang ditampilkan bar (Hz). */
const VOICE_LOW_HZ = 85;
const VOICE_HIGH_HZ = 3000;

/**
 * Petakan data `AnalyserNode.getByteFrequencyData` ke `bars` level 0..1,
 * simetris: frekuensi rendah (energi suara terbesar) di tengah, makin tinggi
 * makin ke tepi — bentuk gelombang ala voice mode. `binHz` = lebar satu bin
 * (`sampleRate / fftSize`).
 */
export function barLevels(freq: ArrayLike<number>, bars: number, binHz: number): number[] {
  const half = Math.ceil(bars / 2);
  const lo = Math.max(1, Math.floor(VOICE_LOW_HZ / binHz));
  const hi = Math.max(lo + half, Math.ceil(VOICE_HIGH_HZ / binHz));
  const span = (hi - lo) / half;
  const levels: number[] = [];
  for (let i = 0; i < half; i++) {
    const start = lo + Math.floor(i * span);
    const end = Math.max(start + 1, lo + Math.floor((i + 1) * span));
    let sum = 0;
    let count = 0;
    for (let b = start; b < end && b < freq.length; b++) {
      sum += freq[b] ?? 0;
      count++;
    }
    levels.push(count === 0 ? 0 : sum / count / 255);
  }
  const left = [...levels].reverse();
  // Jumlah bar ganjil: bar tengah tidak dobel.
  return [...left, ...(bars % 2 === 0 ? levels : levels.slice(1))];
}

/** Rentang kenyaringan yang dipetakan ke 0..1 (dBFS). */
const QUIET_DB = -55;
const LOUD_DB = -12;

/**
 * Kenyaringan 0..1 dari `AnalyserNode.getByteTimeDomainData` (RMS -> dBFS).
 * Hening/derau ruangan ~0, bicara normal ~0.5–0.9 — tinggi bar mengikuti
 * suara, bukan derau (spektrum mentah tetap "setengah penuh" saat hening).
 */
export function volumeLevel(timeDomain: ArrayLike<number>): number {
  if (timeDomain.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const v = ((timeDomain[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeDomain.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - QUIET_DB) / (LOUD_DB - QUIET_DB)));
}

/**
 * Tinggi bar (proporsi 0..1): bentuk dari spektrum (`levels`, dinormalisasi ke
 * puncaknya) dikali kenyaringan `volume`. Hening -> semua `floor`; bicara
 * keras -> bar dengan frekuensi dominan mencapai penuh.
 */
export function waveformHeights(
  levels: readonly number[],
  volume: number,
  floor: number,
): number[] {
  const peak = Math.max(...levels, 0);
  return levels.map((level) => {
    const shape = peak > 0 ? level / peak : 0;
    return floor + (1 - floor) * volume * (0.3 + 0.7 * shape);
  });
}

// ------------------------------------------------------- bahasa dikte ----

export type SpeechLangPref = "id-ID" | "en-US" | "browser";

export const SPEECH_LANG_KEY = "kcg-code:speech-lang";
const DEFAULT_LANG: SpeechLangPref = "id-ID";

export const SPEECH_LANG_OPTIONS: readonly { value: SpeechLangPref; label: string }[] = [
  { value: "id-ID", label: "Bahasa Indonesia" },
  { value: "en-US", label: "English" },
  { value: "browser", label: "Match browser" },
];

function isLangPref(value: unknown): value is SpeechLangPref {
  return SPEECH_LANG_OPTIONS.some((o) => o.value === value);
}

/** Tag BCP-47 untuk `SpeechRecognition.lang`. */
export function resolveSpeechLang(pref: SpeechLangPref, browserLang: string | undefined): string {
  return pref === "browser" ? browserLang || "en-US" : pref;
}

function readStoredLang(): SpeechLangPref {
  try {
    const value = localStorage.getItem(SPEECH_LANG_KEY);
    return isLangPref(value) ? value : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

// Store modul + `useSyncExternalStore` (pola sama dengan `lib/appearance.ts`):
// Settings & composer selalu sinkron, termasuk antar tab.
let langPref = readStoredLang();
const listeners = new Set<() => void>();

function commitLang(next: SpeechLangPref): void {
  if (next === langPref) return;
  langPref = next;
  for (const l of listeners) l();
}

/** Bahasa dikte di perangkat ini. Default: Bahasa Indonesia. */
export function speechLangPref(): SpeechLangPref {
  return langPref;
}

export function setSpeechLangPref(next: SpeechLangPref): void {
  try {
    if (next === DEFAULT_LANG) localStorage.removeItem(SPEECH_LANG_KEY);
    else localStorage.setItem(SPEECH_LANG_KEY, next);
  } catch {
    // Storage diblokir: preferensi hanya berlaku sampai halaman ditutup.
  }
  commitLang(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  // Diubah dari tab lain (`key` null = storage dibersihkan seluruhnya).
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === SPEECH_LANG_KEY) commitLang(readStoredLang());
  });
}

export function useSpeechLangPref(): SpeechLangPref {
  return useSyncExternalStore(subscribe, speechLangPref, () => DEFAULT_LANG);
}
