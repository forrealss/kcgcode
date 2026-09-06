/**
 * Unit test `PromptCard.tsx` (task 24.6).
 *
 * Logika aksi diekstrak sebagai fungsi murni `getPromptActions` sehingga dapat
 * diuji tanpa DOM (pola yang sama dengan `useTheme.test.ts`).
 *
 * - Requirement 8.4: tombol Approve, Deny, dan Cancel tampil untuk tipe
 *   "confirmation".
 * - Requirement 8.5: klik "Cancel" memakai handler/respon yang sama dengan
 *   "Deny" (diteruskan mengikuti mekanisme penyelesaian Requirement 6).
 */
import { describe, expect, test } from "bun:test";
import { getPromptActions, groupPrompts } from "@/lib/prompts";
import type { InteractivePrompt, PromptResponse } from "@/types";

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
  test("tipe confirmation menampilkan tombol Approve, Always allow, Deny, dan Cancel (Req 8.4)", () => {
    const actions = getPromptActions(makePrompt());
    expect(actions.map((a) => a.label)).toEqual(["Approve", "Always allow", "Deny", "Cancel"]);
    expect(actions.map((a) => a.key)).toEqual(["approve", "always", "deny", "cancel"]);
    expect(actions.find((a) => a.key === "always")?.response).toBe("always");
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

  test("question custom: aksi opsi tetap sama — jawaban bebas dikirim sebagai { option }", () => {
    const prompt = makePrompt({
      kind: "question",
      type: "menu",
      custom: true,
      options: ["Fix bug"],
    });
    const actions = getPromptActions(prompt);
    expect(actions.map((a) => a.response)).toEqual([{ option: "Fix bug" }]);
    // Bentuk respon jawaban kustom identik dengan opsi terdaftar.
    const custom: PromptResponse = { option: "jawaban sendiri" };
    expect(custom).toEqual({ option: "jawaban sendiri" });
  });
});

describe("groupPrompts — pengelompokan permission identik (bug kartu nyepam)", () => {
  test("prompt identik (kind+title) masuk satu grup", () => {
    const a = makePrompt({ id: "per_a", title: "external_directory — `D:\\p\\**`" });
    const b = makePrompt({ id: "per_b", title: "external_directory — `D:\\p\\**`", createdAt: 2 });
    const c = makePrompt({ id: "per_c", title: "bash — `ls`", createdAt: 3 });
    const groups = groupPrompts([a, b, c]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.map((p) => p.id)).toEqual(["per_a", "per_b"]);
    expect(groups[1]?.map((p) => p.id)).toEqual(["per_c"]);
  });

  test("question tidak tercampur permission walau judul sama", () => {
    const q = makePrompt({ id: "que_1", kind: "question", type: "menu", title: "lanjut?" });
    const p = makePrompt({ id: "per_1", title: "lanjut?" });
    const groups = groupPrompts([q, p]);
    expect(groups).toHaveLength(2);
  });

  test("title null dan urutan kemunculan dipertahankan", () => {
    const groups = groupPrompts([
      makePrompt({ id: "p2", title: null, createdAt: 2 }),
      makePrompt({ id: "p1", title: "bash — `ls`", createdAt: 1 }),
      makePrompt({ id: "p3", title: null, createdAt: 3 }),
    ]);
    expect(groups.map((g) => g[0]?.id)).toEqual(["p2", "p1"]);
    expect(groups[0]).toHaveLength(2);
  });

  test("daftar kosong -> tanpa grup", () => {
    expect(groupPrompts([])).toHaveLength(0);
  });
});
