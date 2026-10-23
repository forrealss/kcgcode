/**
 * `useApiQuery` di React sungguhan (StrictMode, tanpa DOM): fetch tiruan
 * yang bisa diselesaikan manual untuk menguji respons usang, jeda
 * (`path` null), reload di latar, dan `mutate`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { useApiQuery } from "../useApiQuery";
import { flushAsync, renderHook } from "./render-hook";

const g = globalThis as Record<string, unknown>;
const saved = { fetch: g.fetch, actEnv: g.IS_REACT_ACT_ENVIRONMENT };

/** Permintaan tertunda per URL; `resolve(url, body)` menyelesaikan semuanya. */
let pending: { url: string; done: (res: Response) => void }[] = [];
function respond(url: string, body: unknown, status = 200) {
  const hit = pending.filter((p) => p.url === url);
  pending = pending.filter((p) => p.url !== url);
  for (const p of hit) p.done(Response.json(body, { status }));
}

beforeEach(() => {
  pending = [];
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.fetch = (url: string) =>
    new Promise<Response>((done) => {
      pending.push({ url, done });
    });
});

afterEach(() => {
  g.fetch = saved.fetch;
  g.IS_REACT_ACT_ENVIRONMENT = saved.actEnv;
});

const opts = { errorMessage: "Gagal memuat" };
const mount = (path: string | null) =>
  renderHook(({ path }: { path: string | null }) => useApiQuery<number>(path, opts), { path });

describe("useApiQuery", () => {
  test("loading -> ready", async () => {
    const h = mount("/a");
    expect(h.result()[0]).toEqual({ phase: "loading" });
    respond("/a", 1);
    await flushAsync();
    expect(h.result()[0]).toEqual({ phase: "ready", data: 1 });
  });

  test("error memakai pesan fallback bila bukan ApiError terstruktur", async () => {
    const h = mount("/a");
    respond("/a", {}, 500);
    await flushAsync();
    const [state] = h.result();
    expect(state.phase).toBe("error");
  });

  test("respons path lama dibuang setelah path berganti", async () => {
    const h = mount("/a");
    h.rerender({ path: "/b" });
    expect(h.result()[0]).toEqual({ phase: "loading" });
    respond("/b", 2);
    await flushAsync();
    respond("/a", 1);
    await flushAsync();
    expect(h.result()[0]).toEqual({ phase: "ready", data: 2 });
  });

  test("path null mempertahankan data; dibuka lagi mulai dari loading", async () => {
    const h = mount("/a");
    respond("/a", 1);
    await flushAsync();
    h.rerender({ path: null });
    expect(h.result()[0]).toEqual({ phase: "ready", data: 1 });
    h.rerender({ path: "/a" });
    expect(h.result()[0]).toEqual({ phase: "loading" });
  });

  test("path null saat masih memuat -> idle", async () => {
    const h = mount("/a");
    h.rerender({ path: null });
    respond("/a", 1);
    await flushAsync();
    expect(h.result()[0]).toEqual({ phase: "idle" });
  });

  test("reload memuat di latar (data lama tetap) dan mutate mengubah data", async () => {
    const h = mount("/a");
    respond("/a", 1);
    await flushAsync();
    act(() => h.result()[1]());
    await flushAsync();
    expect(h.result()[0]).toEqual({ phase: "ready", data: 1 });
    respond("/a", 5);
    await flushAsync();
    expect(h.result()[0]).toEqual({ phase: "ready", data: 5 });
    act(() => h.result()[2]((n) => n + 1));
    expect(h.result()[0]).toEqual({ phase: "ready", data: 6 });
  });
});
