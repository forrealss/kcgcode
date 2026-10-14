import { expect, test } from "bun:test";
import {
  PROCESSING_GLOW_KEY,
  processingGlowEnabled,
  setProcessingGlowEnabled,
} from "../appearance";

test("glow saat memproses default mati", () => {
  expect(processingGlowEnabled()).toBe(false);
});

test("dinyalakan & dimatikan dari Settings, tersimpan per perangkat", () => {
  const store = new Map<string, string>();
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
  try {
    setProcessingGlowEnabled(true);
    expect(processingGlowEnabled()).toBe(true);
    expect(store.get(PROCESSING_GLOW_KEY)).toBe("on");

    setProcessingGlowEnabled(false);
    expect(processingGlowEnabled()).toBe(false);
    expect(store.has(PROCESSING_GLOW_KEY)).toBe(false);
  } finally {
    globalThis.localStorage = original;
  }
});

test("storage diblokir -> pilihan tetap berlaku di memori", () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  } as unknown as Storage;
  try {
    setProcessingGlowEnabled(true);
    expect(processingGlowEnabled()).toBe(true);
  } finally {
    setProcessingGlowEnabled(false);
    globalThis.localStorage = original;
  }
});
