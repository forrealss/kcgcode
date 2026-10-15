/**
 * Unit test navigasi SPA (src/hooks/useRouter.ts).
 *
 * `bun test` tidak menyediakan DOM, sehingga hanya `navigate` yang diuji
 * aman dipanggil tanpa History API. Pemetaan pathname -> view diuji lewat
 * `parseRoute()` di `src/lib/__tests__/routes.test.ts`; hook `useRouter`
 * diuji manual via dev server.
 */
import { describe, expect, test } from "bun:test";
import type { MouseEvent } from "react";
import { navigate, spaLinkClick } from "../useRouter";

describe("navigate", () => {
  test("aman dipanggil tanpa History API (lingkungan non-browser)", () => {
    // Di bun test tidak ada `window` -> tidak boleh melempar.
    expect(() => navigate("/projects/p1")).not.toThrow();
  });
});

describe("spaLinkClick", () => {
  /** Event klik tiruan secukupnya untuk handler (tanpa DOM). */
  function click(
    over: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey", boolean>> = {},
    button = 0,
  ) {
    const e = {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      button,
      ...over,
      prevented: false,
    };
    const event = Object.assign(e, {
      preventDefault: () => {
        e.prevented = true;
      },
    });
    return event as typeof event & MouseEvent<HTMLAnchorElement>;
  }

  test("klik kiri biasa -> preventDefault + navigasi SPA", () => {
    let navigated = 0;
    const e = click();
    spaLinkClick(() => navigated++)(e);
    expect(e.prevented).toBe(true);
    expect(navigated).toBe(1);
  });

  test("Ctrl/Cmd/Shift-klik & klik tengah dibiarkan ke browser (tab baru)", () => {
    let navigated = 0;
    const handler = spaLinkClick(() => navigated++);
    for (const e of [
      click({ ctrlKey: true }),
      click({ metaKey: true }),
      click({ shiftKey: true }),
      click({}, 1),
    ]) {
      handler(e);
      expect(e.prevented).toBe(false);
    }
    expect(navigated).toBe(0);
  });
});
