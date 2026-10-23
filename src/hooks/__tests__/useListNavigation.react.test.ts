/** `useListNavigation` di React sungguhan (StrictMode, tanpa DOM). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { useListNavigation } from "../useListNavigation";
import { renderHook } from "./render-hook";

const g = globalThis as Record<string, unknown>;
const savedActEnv = g.IS_REACT_ACT_ENVIRONMENT;
beforeEach(() => {
  g.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedActEnv;
});

function setup(count: number, active = true) {
  const picked: number[] = [];
  let closed = 0;
  const h = renderHook(
    ({ count, active }) =>
      useListNavigation({
        count,
        active,
        onSelect: (i) => {
          picked.push(i);
          return true;
        },
        onClose: () => {
          closed += 1;
        },
      }),
    { count, active },
  );
  const press = (key: string) => {
    let handled = false;
    act(() => {
      handled = h.result().handleKeyDown({ key, preventDefault() {} });
    });
    return handled;
  };
  return { h, press, picked, closed: () => closed };
}

describe("useListNavigation", () => {
  test("panah memutar sorotan, Enter memilih yang tersorot", () => {
    const { h, press, picked } = setup(3);
    expect(press("ArrowUp")).toBe(true);
    expect(h.result().highlighted).toBe(2);
    press("ArrowDown");
    press("ArrowDown");
    expect(h.result().highlighted).toBe(1);
    expect(press("Enter")).toBe(true);
    expect(picked).toEqual([1]);
  });

  test("Escape menutup; tombol lain diteruskan", () => {
    const { press, closed } = setup(2);
    expect(press("a")).toBe(false);
    expect(press("Escape")).toBe(true);
    expect(closed()).toBe(1);
  });

  test("tidak aktif -> semua tombol diteruskan; daftar kosong hanya Escape", () => {
    expect(setup(3, false).press("ArrowDown")).toBe(false);
    const empty = setup(0);
    expect(empty.press("Enter")).toBe(false);
    expect(empty.press("Escape")).toBe(true);
  });

  test("sorotan dijepit saat daftar menyusut; resetHighlight kembali ke 0", () => {
    const { h, press } = setup(5);
    press("ArrowUp");
    expect(h.result().highlighted).toBe(4);
    h.rerender({ count: 2, active: true });
    expect(h.result().highlighted).toBe(1);
    act(() => h.result().resetHighlight());
    expect(h.result().highlighted).toBe(0);
  });
});
