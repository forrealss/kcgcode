/**
 * Test perilaku `useSmoothText` di React SUNGGUHAN (StrictMode), tanpa DOM.
 *
 * Renderer minimal `renderHook` (./render-hook.ts, `react-reconciler`) —
 * cukup untuk menjalankan hook, effect, dan StrictMode (effect dipasang ->
 * dibongkar -> dipasang ulang). rAF diganti antrean manual agar frame bisa
 * "dijalankan" deterministik.
 *
 * Regresi yang dijaga: di StrictMode loop rAF pernah mati setelah remount
 * simulasi, sehingga teks baru muncul sekaligus saat streaming selesai.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { useSmoothText } from "../useSmoothText";
import { renderHook } from "./render-hook";

// ---- rAF palsu ----------------------------------------------------------
let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
let now = 0;
const g = globalThis as Record<string, unknown>;
const saved = {
  raf: g.requestAnimationFrame,
  caf: g.cancelAnimationFrame,
  win: g.window,
  actEnv: g.IS_REACT_ACT_ENVIRONMENT,
};

function runFrames(n: number, dt = 16) {
  for (let i = 0; i < n; i++) {
    now += dt;
    const batch = rafQueue;
    rafQueue = new Map();
    act(() => {
      for (const cb of batch.values()) cb(now);
    });
  }
}

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  now = 0;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafId += 1;
    rafQueue.set(rafId, cb);
    return rafId;
  };
  g.cancelAnimationFrame = (id: number) => {
    rafQueue.delete(id);
  };
  // `prefersReducedMotion` membaca window.matchMedia.
  g.window = { matchMedia: () => ({ matches: false }) };
  g.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
  g.window = saved.win;
  g.IS_REACT_ACT_ENVIRONMENT = saved.actEnv;
});

// ---- renderer tanpa DOM ---------------------------------------------------
function mount() {
  let h: ReturnType<typeof renderHook<{ text: string; on: boolean }, string>> | null = null;
  const render = (text: string, on: boolean) => {
    if (h) h.rerender({ text, on });
    else h = renderHook(({ text, on }) => useSmoothText(text, on), { text, on });
  };
  return { render, shown: () => h?.result() ?? "" };
}

describe("useSmoothText (StrictMode)", () => {
  test("teks tampil bertahap SELAMA streaming, bukan sekaligus di akhir", () => {
    const h = mount();
    h.render("", true);
    h.render("Kucing adalah hewan peliharaan yang sudah lama hidup bersama manusia.", true);

    runFrames(3);
    const partial = h.shown();
    // Sudah mulai tampil, tapi belum semuanya -> benar-benar bertahap.
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(70);

    runFrames(200);
    expect(h.shown()).toBe("Kucing adalah hewan peliharaan yang sudah lama hidup bersama manusia.");
  });

  test("delta baru yang tiba di tengah animasi ikut dikejar", () => {
    const h = mount();
    h.render("Halo", true);
    runFrames(100);
    expect(h.shown()).toBe("Halo");

    h.render("Halo, apa kabar hari ini?", true);
    runFrames(1);
    expect(h.shown().length).toBeLessThan("Halo, apa kabar hari ini?".length);
    runFrames(200);
    expect(h.shown()).toBe("Halo, apa kabar hari ini?");
  });

  test("streaming selesai -> teks penuh seketika", () => {
    const h = mount();
    h.render("", true);
    h.render("Jawaban panjang yang belum sempat tampil semua.", true);
    runFrames(1);
    h.render("Jawaban panjang yang belum sempat tampil semua.", false);
    expect(h.shown()).toBe("Jawaban panjang yang belum sempat tampil semua.");
  });

  test("tidak streaming (riwayat) -> teks penuh tanpa animasi", () => {
    const h = mount();
    h.render("Pesan lama dari riwayat.", false);
    expect(h.shown()).toBe("Pesan lama dari riwayat.");
    expect(rafQueue.size).toBe(0);
  });
});
