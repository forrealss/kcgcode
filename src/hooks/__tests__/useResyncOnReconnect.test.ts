/**
 * Test `useResyncOnReconnect` di React sungguhan (tanpa DOM, renderer minimal
 * dari `react-reconciler` — pola yang sama dengan `useSmoothText.react.test`).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { act, createElement, StrictMode } from "react";
import Reconciler from "react-reconciler";
import { useResyncOnReconnect } from "../useResyncOnReconnect";
import type { WsConnectionStatus } from "../useWebSocket";

const g = globalThis as Record<string, unknown>;

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
});

function mount() {
  let calls = 0;
  function Probe({ status }: { status: WsConnectionStatus }) {
    useResyncOnReconnect(status, () => {
      calls += 1;
    });
    return null;
  }
  const root = reconciler.createContainer(
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
  const render = (status: WsConnectionStatus) =>
    act(() => {
      reconciler.updateContainer(
        createElement(StrictMode, null, createElement(Probe, { status })),
        root,
        null,
        null,
      );
    });
  return { render, calls: () => calls };
}

beforeEach(() => {
  g.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useResyncOnReconnect", () => {
  test("koneksi pertama TIDAK memicu resync", () => {
    const h = mount();
    h.render("connecting");
    h.render("connected");
    expect(h.calls()).toBe(0);
  });

  test("tersambung ulang setelah putus -> resync sekali", () => {
    const h = mount();
    h.render("connecting");
    h.render("connected");
    h.render("reconnecting");
    h.render("connected");
    expect(h.calls()).toBe(1);
    // Tetap terhubung -> tidak berulang.
    h.render("connected");
    expect(h.calls()).toBe(1);
  });

  test("setiap putus-sambung memicu resync", () => {
    const h = mount();
    h.render("connected");
    for (let i = 0; i < 3; i++) {
      h.render("reconnecting");
      h.render("connected");
    }
    expect(h.calls()).toBe(3);
  });
});
