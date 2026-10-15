import { describe, expect, test } from "bun:test";
import {
  barLevels,
  mergeDictation,
  resolveSpeechLang,
  resolveSpeechSupport,
  SPEECH_LANG_KEY,
  setSpeechLangPref,
  speechErrorMessage,
  speechLangPref,
  volumeLevel,
  waveformHeights,
} from "../speech";

describe("resolveSpeechSupport", () => {
  test("HTTP biasa -> insecure (mic diblokir browser)", () => {
    expect(resolveSpeechSupport({ secure: false, hasRecognition: true })).toBe("insecure");
  });
  test("tanpa Web Speech API -> unsupported", () => {
    expect(resolveSpeechSupport({ secure: true, hasRecognition: false })).toBe("unsupported");
  });
  test("secure + API ada -> supported", () => {
    expect(resolveSpeechSupport({ secure: true, hasRecognition: true })).toBe("supported");
  });
});

describe("mergeDictation", () => {
  test("input kosong: hanya ucapan, spasi dirapikan", () => {
    expect(mergeDictation("", " halo", "  apa kabar ")).toBe("halo apa kabar");
  });
  test("tanpa ucapan: teks ketikan utuh", () => {
    expect(mergeDictation("ketik dulu", "", " ")).toBe("ketik dulu");
  });
  test("ucapan disambung ke teks ketikan dengan satu spasi", () => {
    expect(mergeDictation("tolong", "perbaiki bug", "")).toBe("tolong perbaiki bug");
    expect(mergeDictation("baris satu\n", "baris dua", "")).toBe("baris satu\nbaris dua");
  });
});

describe("barLevels", () => {
  // 512-pt FFT @ 48 kHz -> 93.75 Hz/bin.
  const binHz = 48000 / 512;

  test("jumlah bar sesuai & simetris", () => {
    const freq = Array.from({ length: 256 }, (_, i) => 255 - i);
    for (const bars of [20, 21]) {
      const levels = barLevels(freq, bars, binHz);
      expect(levels).toHaveLength(bars);
      expect(levels).toEqual([...levels].reverse());
    }
  });

  test("frekuensi rendah (energi suara terbesar) di tengah", () => {
    const freq = Array.from({ length: 256 }, (_, i) => 255 - i);
    const levels = barLevels(freq, 20, binHz);
    expect(levels[9]).toBeGreaterThan(levels[0] ?? 1);
  });

  test("hening -> semua 0; level dinormalisasi 0..1", () => {
    expect(barLevels(new Uint8Array(256), 20, binHz).every((v) => v === 0)).toBe(true);
    const loud = barLevels(new Uint8Array(256).fill(255), 20, binHz);
    expect(loud.every((v) => v === 1)).toBe(true);
  });
});

describe("volumeLevel", () => {
  /** Gelombang sinus byte (128 = nol) dengan amplitudo 0..1. */
  const sine = (amp: number) =>
    Array.from({ length: 512 }, (_, i) => 128 + amp * 127 * Math.sin((i / 512) * Math.PI * 16));

  test("hening -> 0; derau sangat pelan tetap ~0", () => {
    expect(volumeLevel(new Uint8Array(512).fill(128))).toBe(0);
    expect(volumeLevel(sine(0.001))).toBe(0);
  });

  test("makin keras makin tinggi, dibatasi 1", () => {
    const soft = volumeLevel(sine(0.02));
    const normal = volumeLevel(sine(0.1));
    expect(soft).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(soft);
    expect(volumeLevel(sine(1))).toBe(1);
  });
});

describe("waveformHeights", () => {
  const levels = [0.2, 0.6, 0.6, 0.2];

  test("hening -> semua bar di lantai, bentuk spektrum diabaikan", () => {
    expect(waveformHeights(levels, 0, 0.14)).toEqual([0.14, 0.14, 0.14, 0.14]);
  });

  test("keras -> frekuensi dominan penuh, bentuk & simetri dipertahankan", () => {
    const h = waveformHeights(levels, 1, 0.14);
    expect(h[1]).toBeCloseTo(1);
    expect(h[0]).toBeLessThan(h[1] ?? 0);
    expect(h).toEqual([...h].reverse());
  });
});

describe("bahasa dikte", () => {
  test("default Bahasa Indonesia; 'browser' -> bahasa navigator", () => {
    expect(speechLangPref()).toBe("id-ID");
    expect(resolveSpeechLang("id-ID", "en-GB")).toBe("id-ID");
    expect(resolveSpeechLang("browser", "en-GB")).toBe("en-GB");
    expect(resolveSpeechLang("browser", undefined)).toBe("en-US");
  });

  test("pilihan tersimpan per perangkat (default tidak ditulis)", () => {
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    try {
      setSpeechLangPref("en-US");
      expect(speechLangPref()).toBe("en-US");
      expect(store.get(SPEECH_LANG_KEY)).toBe("en-US");
      setSpeechLangPref("id-ID");
      expect(speechLangPref()).toBe("id-ID");
      expect(store.has(SPEECH_LANG_KEY)).toBe(false);
    } finally {
      globalThis.localStorage = original;
    }
  });
});

test("pesan error: no-speech/aborted diam, izin ditolak dijelaskan", () => {
  expect(speechErrorMessage("no-speech")).toBeNull();
  expect(speechErrorMessage("aborted")).toBeNull();
  expect(speechErrorMessage("not-allowed")).toContain("blocked");
  expect(speechErrorMessage("audio-capture")).toContain("microphone");
});
