/**
 * `renderHook` untuk `bun test` tanpa DOM — renderer "null" dari
 * `react-reconciler` (dependensi transitif) yang hanya menjalankan komponen,
 * hook, dan effect. Default di StrictMode (effect dipasang -> dibongkar ->
 * dipasang ulang) agar regresi cleanup ikut tertangkap.
 *
 * Pemanggil wajib menyetel `globalThis.IS_REACT_ACT_ENVIRONMENT = true`.
 */
import { act, createElement, StrictMode } from "react";
import Reconciler from "react-reconciler";

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

export interface RenderedHook<P, R> {
  /** Nilai kembalian hook pada render terakhir. */
  result: () => R;
  rerender: (props: P) => void;
  unmount: () => void;
}

export function renderHook<P, R>(
  hook: (props: P) => R,
  initialProps: P,
  { strict = true }: { strict?: boolean } = {},
): RenderedHook<P, R> {
  let latest: R | undefined;
  function Probe({ props }: { props: P }) {
    latest = hook(props);
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
  const update = (el: unknown) =>
    act(() => {
      reconciler.updateContainer(el as never, root as never, null, null);
    });
  const rerender = (props: P) => {
    const probe = createElement(Probe, { props });
    update(strict ? createElement(StrictMode, null, probe) : probe);
  };
  rerender(initialProps);
  return {
    result: () => latest as R,
    rerender,
    unmount: () => update(null),
  };
}

/** Jalankan microtask/timer tertunda (promise fetch tiruan) di dalam `act`. */
export async function flushAsync(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
