/**
 * Unit test navigasi SPA (src/hooks/useRouter.ts).
 *
 * `bun test` tidak menyediakan DOM, sehingga hanya `navigate` yang diuji
 * aman dipanggil tanpa History API. Pemetaan pathname -> view diuji lewat
 * `parseRoute()` di `src/lib/__tests__/routes.test.ts`; hook `useRouter`
 * diuji manual via dev server.
 */
import { describe, expect, test } from "bun:test";
import { navigate } from "../useRouter";

describe("navigate", () => {
  test("aman dipanggil tanpa History API (lingkungan non-browser)", () => {
    // Di bun test tidak ada `window` -> tidak boleh melempar.
    expect(() => navigate("/projects/p1")).not.toThrow();
  });
});
