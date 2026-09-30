/**
 * Test perilaku `useSmoothText` di React SUNGGUHAN (StrictMode), tanpa DOM.
 *
 * Renderer minimal dibangun dari `react-reconciler` (sudah terpasang sebagai
 * dependensi transitif) — cukup untuk menjalankan hook, effect, dan
 * StrictMode (effect dipasang -> dibongkar -> dipasang ulang). rAF diganti
 * antrean manual agar frame bisa "dijalankan" deterministik.
 *
 * Regresi yang dijaga: di StrictMode loop rAF pernah mati setelah remount
 * simulasi, sehingga teks baru muncul sekaligus saat streaming selesai.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, createElement, StrictMode } from "react";
import Reconciler from "react-reconciler";
import { useSmoothText } from "../useSmoothText";

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
/** Renderer "null": tidak membuat node apa pun, cukup menjalankan komponen. */
const reconciler = Reconciler({
  supportsMutation: true,
  isPrimaryRenderer: false,
  createInstance: () => ({}),
  createTextInstance: () => ({}),
  appendInitialChild: () => {},
  appendChild: () => {},
  appendChildToContainer: () => {},
  insertBefore: () => {},
  insertInContainerBefore: () => {},
  removeChild: () => {},
  removeChildFromContainer: () => {},
  commitTextUpdate: () => {},
  commitUpdate: () => {},
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: () => ({}),
  getPublicInstance: (i: unknown) => i,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  preparePortalMount: () => {},
  clearContainer: () => {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentUpdatePriority: () => 32,
  setCurrentUpdatePriority: () => {},
  resolveUpdatePriority: () => 32,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null,
  HostTransitionContext: { $$typeof: Symbol.for("react.context"), _currentValue: null },
  resetFormInstance: () => {},
  requestPostPaintCallback: () => {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
} as never);

function mount() {
  let latest = "";
  function Probe({ text, on }: { text: string; on: boolean }) {
    latest = useSmoothText(text, on);
    return null;
  }
  const root = (
    reconciler as never as {
      createContainer: (...a: unknown[]) => unknown;
    }
  ).createContainer(
    {},
    1,
    null,
    false,
    null,
    "",
    () => {},
    () => {},
    () => {},
    null,
  );
  const render = (text: string, on: boolean) =>
    act(() => {
      reconciler.updateContainer(
        createElement(StrictMode, null, createElement(Probe, { text, on })),
        root as never,
        null,
        null,
      );
    });
  return { render, shown: () => latest };
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
