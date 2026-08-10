/**
 * Property & unit test `prompt-detector.ts` (task 15.2).
 * - Property 17: Deteksi pola Interactive_Prompt (Requirements 6.1, 6.2)
 */
import { expect, test } from "bun:test";
import fc from "fast-check";
import { detectPrompt } from "../prompt-detector";

// Feature: kcg-bridge, Property 17: Deteksi pola Interactive_Prompt
test("Property 17: pola konfirmasi -> draft confirmation (di posisi teks mana pun)", () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 20 }),
      fc.string({ maxLength: 20 }),
      fc.constantFrom(
        "Do you want to proceed? (y/n)",
        "Allow this command?",
        "Apply this edit?",
        "[y/N]",
        "proceed with this action?",
        "proceed with this edit?",
        "(y/n)",
      ),
      (pre, post, pattern) => {
        const res = detectPrompt(`${pre} ${pattern} ${post}`);
        expect(res).not.toBeNull();
        if (res) expect(res.type).toBe("confirmation");
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: kcg-bridge, Property 17: Deteksi pola Interactive_Prompt (menu)
test("Property 17: menu bernomor -> draft menu dengan options yang sama", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("save", "quit", "retry", "cancel", "open", "skip"), {
        minLength: 2,
        maxLength: 5,
      }),
      (opts) => {
        const lines = opts.map((o, i) => `${i + 1}) ${o}`).join("\n");
        const res = detectPrompt(lines);
        expect(res?.type).toBe("menu");
        if (res?.type === "menu") expect(res.options).toEqual(opts);
      },
    ),
    { numRuns: 100 },
  );
});

// ---- unit test tambahan ----
test("15: teks tanpa pola -> null", () => {
  expect(detectPrompt("hello world, nothing here")).toBeNull();
});

test("15: konfirmasi y/n terdeteksi", () => {
  const res = detectPrompt("Would you like to continue? (y/n)");
  expect(res).toEqual({ type: "confirmation", options: null });
});

test("15: izin eksekusi command terdeteksi", () => {
  const res = detectPrompt("Allow this command?");
  expect(res?.type).toBe("confirmation");
});

test("15: menu tunggal (kurang dari 2 opsi) tidak dikenali sebagai menu", () => {
  const res = detectPrompt("1) hanya satu");
  expect(res).toBeNull();
});

test("15: menu dengan opsi tidak berurutan tidak dikenali", () => {
  const res = detectPrompt("2) opsi\n5) opsi");
  expect(res).toBeNull();
});
