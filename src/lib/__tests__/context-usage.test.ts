/**
 * Unit test helper tampilan context window & compact (src/lib/context-usage.ts).
 */
import { describe, expect, test } from "bun:test";
import type { MessagePart, SessionMessage } from "@/types";
import { compactionLabel, formatTokens, usageLevel } from "../context-usage";
import { hasVisibleContent, turnBlocks, turnSegments, turnStatus } from "../turns";

describe("formatTokens", () => {
  test("ringkas per besaran; desimal hanya bila bermakna", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(3_847)).toBe("3.8k");
    expect(formatTokens(33_333)).toBe("33.3k");
    expect(formatTokens(50_000)).toBe("50k");
    expect(formatTokens(167_400)).toBe("167k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("usageLevel", () => {
  test("normal < 75% <= warning < 90% <= critical; tanpa batas = normal", () => {
    expect(usageLevel(null)).toBe("normal");
    expect(usageLevel(74)).toBe("normal");
    expect(usageLevel(75)).toBe("warning");
    expect(usageLevel(90)).toBe("critical");
    expect(usageLevel(120)).toBe("critical");
  });
});

describe("compactionLabel", () => {
  test("manual vs auto, dengan ukuran sebelum/sesudah bila ada", () => {
    expect(
      compactionLabel({
        type: "compaction",
        trigger: "manual",
        preTokens: 33_333,
        postTokens: 3_847,
      }),
    ).toBe("Conversation compacted · 33.3k → 3.8k tokens");
    expect(compactionLabel({ type: "compaction", trigger: "auto", preTokens: 900_000 })).toBe(
      "Context auto-compacted · from 900k tokens",
    );
    expect(compactionLabel({ type: "compaction", trigger: "manual" })).toBe(
      "Conversation compacted",
    );
  });
});

describe("penanda compact di model timeline", () => {
  const msg = (parts: MessagePart[]): SessionMessage => ({
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    parts,
    createdAt: 1,
  });

  test("part `compaction` jadi konten blok sendiri, menutup kluster steps sebelumnya", () => {
    const segments = turnSegments([
      msg([
        { id: "r", type: "reasoning", text: "mikir" },
        { id: "c", type: "compaction", trigger: "auto", preTokens: 900_000 },
        { id: "t", type: "text", text: "lanjut" },
      ]),
    ]);
    expect(segments.map((s) => s.kind)).toEqual(["reasoning", "compaction", "text"]);
    const blocks = turnBlocks(segments);
    expect(blocks.map((b) => [b.steps.length, b.content?.kind])).toEqual([
      [1, "compaction"],
      [0, "text"],
    ]);
  });

  test("turn berisi penanda saja tetap terlihat; status live 'Working…'", () => {
    const only = [msg([{ id: "c", type: "compaction", trigger: "manual" }])];
    expect(hasVisibleContent(turnSegments(only))).toBe(true);
    expect(turnStatus(only, true)).toBe("Working…");
  });
});
