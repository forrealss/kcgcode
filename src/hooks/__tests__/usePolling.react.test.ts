/**
 * `usePolling` & `useIncrementalLog` di React sungguhan (StrictMode, tanpa
 * DOM) dengan timer asli berinterval pendek dan fetch tiruan.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useIncrementalLog } from "../useIncrementalLog";
import { usePolling } from "../usePolling";
import { flushAsync, renderHook } from "./render-hook";

const g = globalThis as Record<string, unknown>;
const saved = { fetch: g.fetch, actEnv: g.IS_REACT_ACT_ENVIRONMENT };

beforeEach(() => {
  g.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  g.fetch = saved.fetch;
  g.IS_REACT_ACT_ENVIRONMENT = saved.actEnv;
});

describe("usePolling", () => {
  test("memanggil segera lalu berkala; berhenti saat unmount / dinonaktifkan", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
    };
    const h = renderHook(({ enabled }) => usePolling(fn, 10, { enabled }), { enabled: true });
    expect(calls).toBeGreaterThanOrEqual(1);
    await flushAsync(35);
    const running = calls;
    expect(running).toBeGreaterThanOrEqual(3);

    h.rerender({ enabled: false });
    const paused = calls;
    await flushAsync(30);
    expect(calls).toBe(paused);

    h.rerender({ enabled: true });
    expect(calls).toBe(paused + 1);
    h.unmount();
    const stopped = calls;
    await flushAsync(30);
    expect(calls).toBe(stopped);
  });
});

describe("useIncrementalLog", () => {
  /** Server log tiruan: `lines` bisa ditambah, balas sesuai `?from=`. */
  let server: string[] = [];
  let requests: string[] = [];
  beforeEach(() => {
    server = [];
    requests = [];
    g.fetch = async (url: string) => {
      requests.push(url);
      const from = Number(new URL(url, "http://x").searchParams.get("from"));
      return Response.json({ lines: server.slice(from), next: server.length });
    };
  });

  test("polling menambah baris baru tanpa duplikat", async () => {
    server = ["a", "b"];
    const h = renderHook(() => useIncrementalLog("/logs", { pollMs: 10 }), undefined);
    await flushAsync(5);
    expect(h.result()).toEqual(["a", "b"]);
    server.push("c");
    await flushAsync(30);
    expect(h.result()).toEqual(["a", "b", "c"]);
    h.unmount();
  });

  test("mode offset: ambil hanya saat offset naik; resetKey mengosongkan log", async () => {
    server = ["a"];
    const h = renderHook(
      ({ offset, resetKey }) => useIncrementalLog("/logs", { offset, resetKey }),
      { offset: 1, resetKey: 1 },
    );
    await flushAsync(5);
    expect(h.result()).toEqual(["a"]);
    const count = requests.length;
    h.rerender({ offset: 1, resetKey: 1 });
    await flushAsync(5);
    expect(requests.length).toBe(count);

    server.push("b");
    h.rerender({ offset: 2, resetKey: 1 });
    await flushAsync(5);
    expect(h.result()).toEqual(["a", "b"]);

    server = ["x"];
    h.rerender({ offset: 1, resetKey: 2 });
    await flushAsync(5);
    expect(h.result()).toEqual(["x"]);
  });

  test("max membatasi jumlah baris", async () => {
    server = ["1", "2", "3", "4"];
    const h = renderHook(() => useIncrementalLog("/logs", { offset: 4, max: 2 }), undefined);
    await flushAsync(5);
    expect(h.result()).toEqual(["3", "4"]);
  });
});
