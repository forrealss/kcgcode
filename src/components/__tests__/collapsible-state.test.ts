/**
 * Property test collapsible thinking block (task 24.8).
 *
 * // Feature: kcg-bridge, Property 25: Toggle collapsible thinking independen antar pesan
 * // Validates: Requirements 8.3
 *
 * For any himpunan pesan dan sembarang urutan aksi toggle collapsible pada
 * masing-masing pesan, status tampil/tersembunyi setiap pesan setelah seluruh
 * aksi = hasil XOR paritas jumlah toggle yang diterapkan pada pesan itu
 * sendiri terhadap nilai default `true` (expanded), dan tidak terpengaruh
 * oleh toggle pada pesan lain.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  extendCollapsed,
  initialCollapsedState,
  initialCollapsibleState,
  isCollapsibleExpanded,
  toggleCollapsible,
} from "../collapsible-state";

describe("collapsible-state — Property 25", () => {
  // Feature: kcg-bridge, Property 25: Toggle collapsible thinking independen antar pesan
  test("toggle independen antar pesan terhadap default expanded (Req 8.3)", () => {
    fc.assert(
      fc.property(
        // Himpunan identitas pesan unik.
        fc.uniqueArray(fc.string({ maxLength: 12 }), { maxLength: 10 }),
        // Sembarang urutan aksi: indeks pesan yang di-toggle (boleh acak/berulang).
        fc.array(fc.nat({ max: 30 }), { maxLength: 80 }),
        (ids, idxActions) => {
          let state = initialCollapsibleState(ids);
          const toggles = new Map<string, number>();

          for (const idx of idxActions) {
            if (ids.length === 0) break;
            const id = ids[idx % ids.length];
            if (!id) continue;
            state = toggleCollapsible(state, id);
            toggles.set(id, (toggles.get(id) ?? 0) + 1);
          }

          // Status akhir tiap pesan hanya bergantung pada paritas toggle
          // milik pesan itu sendiri terhadap default true (Req 8.3,
          // Property 25) — tidak terpengaruh pesan lain.
          for (const id of ids) {
            const k = toggles.get(id) ?? 0;
            expect(isCollapsibleExpanded(state, id)).toBe(k % 2 === 0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test("pesan baru tanpa state eksplisit default expanded (Req 8.3)", () => {
    const state = initialCollapsibleState(["a"]);
    expect(isCollapsibleExpanded(state, "a")).toBe(true);
    expect(isCollapsibleExpanded(state, "b")).toBe(true);
  });

  // Reason: render Thinking sekarang default collapsed (dibatasi tinggi),
  // dapat di-expand per part — perilaku baru dari sesi headless.
  test("initialCollapsedState: seluruh reasoning default tertutup", () => {
    const state = initialCollapsedState(["m1:0", "m1:1"]);
    expect(isCollapsibleExpanded(state, "m1:0")).toBe(false);
    expect(isCollapsibleExpanded(state, "m1:1")).toBe(false);
  });

  test("extendCollapsed: key baru tertutup, key yang sudah ada dipertahankan", () => {
    let state = initialCollapsedState(["m1:0"]);
    state = toggleCollapsible(state, "m1:0"); // user expand m1:0
    expect(isCollapsibleExpanded(state, "m1:0")).toBe(true);

    // Pesan baru datang -> reasoning-nya collapsed; m1:0 tetap expanded.
    state = extendCollapsed(state, ["m2:0", "m2:1"]);
    expect(isCollapsibleExpanded(state, "m1:0")).toBe(true);
    expect(isCollapsibleExpanded(state, "m2:0")).toBe(false);
    expect(isCollapsibleExpanded(state, "m2:1")).toBe(false);
    expect(isCollapsibleExpanded(state, "m3:0")).toBe(true); // tak dikenal -> default
  });

  test("extendCollapsed: daftar kosong tidak mengubah state", () => {
    const state = initialCollapsedState(["a"]);
    expect(extendCollapsed(state, [])).toBe(state);
  });

  test("urutan toggle sederhana membalik status pesan terkait saja", () => {
    let state = initialCollapsibleState(["a", "b"]);
    state = toggleCollapsible(state, "a");
    expect(isCollapsibleExpanded(state, "a")).toBe(false);
    expect(isCollapsibleExpanded(state, "b")).toBe(true);

    state = toggleCollapsible(state, "b");
    state = toggleCollapsible(state, "b");
    expect(isCollapsibleExpanded(state, "b")).toBe(true);
    expect(isCollapsibleExpanded(state, "a")).toBe(false);
  });
});
