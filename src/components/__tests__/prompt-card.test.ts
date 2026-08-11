/**
 * Unit test `prompt-card.tsx` (task 24.6).
 *
 * Logika aksi diekstrak sebagai fungsi murni `getPromptActions` sehingga dapat
 * diuji tanpa DOM (pola yang sama dengan `use-theme.test.ts`).
 *
 * - Requirement 8.4: tombol Approve, Deny, dan Cancel tampil untuk tipe
 *   "confirmation".
 * - Requirement 8.5: klik "Cancel" memakai handler/respon yang sama dengan
 *   "Deny" (diteruskan mengikuti mekanisme penyelesaian Requirement 6).
 */
import { describe, expect, test } from "bun:test";

import type { InteractivePrompt } from "../../server/types";
import { getPromptActions } from "../prompt-card";

function makePrompt(overrides: Partial<InteractivePrompt> = {}): InteractivePrompt {
  return {
    id: "p1",
    sessionId: "s1",
    kind: "permission",
    type: "confirmation",
    title: "bash:ls",
    options: null,
    status: "pending",
    createdAt: 0,
    resolvedAt: null,
    ...overrides,
  };
}

describe("prompt-card — aksi Interactive_Prompt", () => {
  test("tipe confirmation menampilkan tombol Approve, Deny, dan Cancel (Req 8.4)", () => {
    const actions = getPromptActions(makePrompt());
    expect(actions.map((a) => a.label)).toEqual(["Approve", "Deny", "Cancel"]);
    expect(actions.map((a) => a.key)).toEqual(["approve", "deny", "cancel"]);
  });

  test("Cancel memakai respon yang sama dengan Deny (Req 8.5)", () => {
    const actions = getPromptActions(makePrompt());
    const deny = actions.find((a) => a.key === "deny");
    const cancel = actions.find((a) => a.key === "cancel");
    expect(deny).toBeDefined();
    expect(cancel).toBeDefined();
    // Klik Cancel memperlakukan sebagai respon Deny (bukan "cancel").
    expect(deny?.response).toBe("deny");
    expect(cancel?.response).toBe(deny?.response);
    expect(cancel?.response).toBe("deny");
  });

  test("tipe menu menghasilkan satu aksi per opsi dengan respon { option } (Req 6.3)", () => {
    const prompt = makePrompt({ type: "menu", options: ["Lanjutkan", "Batal"] });
    const actions = getPromptActions(prompt);
    expect(actions).toHaveLength(2);
    expect(actions[0]?.label).toBe("Lanjutkan");
    expect(actions[0]?.response).toEqual({ option: "Lanjutkan" });
    expect(actions[1]?.label).toBe("Batal");
    expect(actions[1]?.response).toEqual({ option: "Batal" });
  });

  test("menu tanpa opsi menghasilkan daftar aksi kosong", () => {
    expect(getPromptActions(makePrompt({ type: "menu", options: [] }))).toHaveLength(0);
  });
});
