/**
 * Unit test helper pemilihan model (src/lib/model-picker.ts) — logika murni,
 * pola sama dengan `session-summary.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import type { ModelOption } from "@/server/services/opencode-client";
import {
  activeModelLabel,
  DEFAULT_MODEL_KEY,
  describeModelCount,
  filterModels,
  groupModels,
  keyOfSessionModel,
  MODEL_NAME_MAX_LENGTH,
  modelKey,
  optionKey,
  parseModelKey,
  shortModelName,
} from "../model-picker";

function option(
  providerID: string,
  providerName: string,
  modelID: string,
  name: string,
): ModelOption {
  return { providerID, providerName, modelID, name };
}

const OPUS = option("kcgrouter", "KCG Router", "kiro/claude-opus-5", "Claude Opus 5");
const SONNET = option("kcgrouter", "KCG Router", "kiro/claude-sonnet-4", "Claude Sonnet 4");
const GPT = option("openai", "OpenAI", "gpt-5", "GPT-5");

describe("kunci model", () => {
  test("modelKey memakai pemisah non-slash (modelID boleh memuat '/')", () => {
    const key = modelKey("kcgrouter", "kiro/claude-opus-5");
    expect(key).toContain("kiro/claude-opus-5");
    expect(parseModelKey(key)).toEqual({
      providerID: "kcgrouter",
      modelID: "kiro/claude-opus-5",
    });
  });

  test("optionKey konsisten dengan modelKey", () => {
    expect(optionKey(OPUS)).toBe(modelKey(OPUS.providerID, OPUS.modelID));
  });

  test("keyOfSessionModel: null -> kunci default", () => {
    expect(keyOfSessionModel(null)).toBe(DEFAULT_MODEL_KEY);
    expect(keyOfSessionModel({ providerID: "openai", modelID: "gpt-5" })).toBe(
      modelKey("openai", "gpt-5"),
    );
  });

  test("parseModelKey: kunci default & kunci tak lengkap -> null", () => {
    expect(parseModelKey(DEFAULT_MODEL_KEY)).toBeNull();
    expect(parseModelKey("")).toBeNull();
    expect(parseModelKey("hanya-provider")).toBeNull();
  });

  test("round-trip kunci untuk sembarang provider/model", () => {
    for (const m of [OPUS, SONNET, GPT]) {
      expect(parseModelKey(optionKey(m))).toEqual({
        providerID: m.providerID,
        modelID: m.modelID,
      });
    }
  });
});

describe("groupModels", () => {
  test("mengelompokkan per provider, urutan kemunculan dipertahankan", () => {
    const groups = groupModels([OPUS, GPT, SONNET]);
    expect(groups.map((g) => g.providerID)).toEqual(["kcgrouter", "openai"]);
    expect(groups[0]?.models.map((m) => m.modelID)).toEqual([
      "kiro/claude-opus-5",
      "kiro/claude-sonnet-4",
    ]);
    expect(groups[0]?.providerName).toBe("KCG Router");
  });

  test("daftar kosong -> kosong", () => {
    expect(groupModels([])).toEqual([]);
  });
});

describe("filterModels", () => {
  const all = [OPUS, SONNET, GPT];

  test("query kosong / whitespace -> semua model", () => {
    expect(filterModels(all, "")).toHaveLength(3);
    expect(filterModels(all, "   ")).toHaveLength(3);
  });

  test("cocok pada nama tanpa membedakan huruf besar/kecil", () => {
    expect(filterModels(all, "OPUS").map((m) => m.modelID)).toEqual(["kiro/claude-opus-5"]);
  });

  test("cocok pada modelID", () => {
    expect(filterModels(all, "gpt-5").map((m) => m.name)).toEqual(["GPT-5"]);
  });

  test("cocok pada nama provider", () => {
    expect(filterModels(all, "openai").map((m) => m.name)).toEqual(["GPT-5"]);
  });

  test("beberapa kata: semua harus cocok, urutan bebas", () => {
    expect(filterModels(all, "opus 5").map((m) => m.modelID)).toEqual(["kiro/claude-opus-5"]);
    expect(filterModels(all, "5 opus").map((m) => m.modelID)).toEqual(["kiro/claude-opus-5"]);
    expect(filterModels(all, "claude router").map((m) => m.modelID)).toEqual([
      "kiro/claude-opus-5",
      "kiro/claude-sonnet-4",
    ]);
  });

  test("tidak ada yang cocok -> kosong", () => {
    expect(filterModels(all, "gemini")).toEqual([]);
  });

  test("input tidak dimutasi", () => {
    const input = [OPUS, GPT];
    filterModels(input, "opus");
    expect(input).toHaveLength(2);
  });
});

describe("activeModelLabel", () => {
  test("model null -> label default", () => {
    expect(activeModelLabel(null, [OPUS])).toBe("Default model");
  });

  test("model dikenal -> nama ramah dari daftar", () => {
    expect(
      activeModelLabel({ providerID: "kcgrouter", modelID: "kiro/claude-opus-5" }, [OPUS]),
    ).toBe("Claude Opus 5");
  });

  test("daftar belum termuat -> jatuh ke modelID (trigger tidak kosong)", () => {
    expect(activeModelLabel({ providerID: "kcgrouter", modelID: "kiro/claude-opus-5" }, [])).toBe(
      "kiro/claude-opus-5",
    );
  });
});

describe("describeModelCount", () => {
  test("nol, satu, dan banyak", () => {
    expect(describeModelCount(0)).toBe("No matching models");
    expect(describeModelCount(1)).toBe("1 model");
    expect(describeModelCount(7)).toBe("7 models");
  });
});

describe("shortModelName", () => {
  test("prefiks vendor dibuang, segmen terakhir dipakai", () => {
    expect(shortModelName("kiro/claude-opus-5")).toBe("claude-opus-5");
    expect(shortModelName("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
  });

  test("prefiks berlapis: tetap segmen terakhir", () => {
    expect(shortModelName("vendor/family/gpt-5")).toBe("gpt-5");
  });

  test("tanpa slash dibiarkan apa adanya", () => {
    expect(shortModelName("Claude Opus 5")).toBe("Claude Opus 5");
  });

  test("trailing slash diabaikan", () => {
    expect(shortModelName("kiro/claude-opus-5/")).toBe("claude-opus-5");
  });

  test("nama panjang dipotong dengan elipsis, total tepat maxLength", () => {
    const long = "a".repeat(40);
    const out = shortModelName(long, 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("nama tepat sepanjang batas tidak dipotong", () => {
    const exact = "b".repeat(MODEL_NAME_MAX_LENGTH);
    expect(shortModelName(exact)).toBe(exact);
  });

  test("spasi sebelum elipsis dirapikan", () => {
    expect(shortModelName("Claude Opus Model Panjang", 12)).toBe("Claude Opus…");
  });

  test("string kosong / hanya slash aman", () => {
    expect(shortModelName("")).toBe("");
    expect(shortModelName("/")).toBe("");
    expect(shortModelName("///")).toBe("");
  });

  test("maxLength nol atau negatif -> string kosong (tanpa crash)", () => {
    expect(shortModelName("apa pun", 0)).toBe("");
    expect(shortModelName("apa pun", -5)).toBe("");
  });

  test("label default tetap terbaca", () => {
    expect(shortModelName("Model default")).toBe("Model default");
  });
});
