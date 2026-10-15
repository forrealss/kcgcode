/** Pemakaian context window & token/biaya per turn dari pesan SDK. */
import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ContextUsage } from "../../../types";
import type { AgentTokenUsage } from "../types";

/**
 * Rincian `getContextUsage` -> tipe tampilan. Hanya kategori yang benar-benar
 * menempati window (`kind: used`) yang dihitung — tool tertunda (`deferred`),
 * sisa ruang, dan cadangan auto-compact bukan "terpakai".
 */
export function contextUsageFrom(
  res: SDKControlGetContextUsageResponse,
  measuredAt: number,
): ContextUsage {
  const max = res.rawMaxTokens || res.maxTokens || null;
  return {
    usedTokens: res.totalTokens,
    maxTokens: max,
    percent: max ? Math.round(res.percentage) : null,
    autoCompactAt: res.isAutoCompactEnabled ? (res.autoCompactThreshold ?? null) : null,
    model: res.model || null,
    categories: res.categories
      .filter((c) => c.kind === "used" && c.tokens > 0)
      .map((c) => ({ name: c.name, tokens: c.tokens }))
      .sort((a, b) => b.tokens - a.tokens),
    measuredAt,
  };
}

/** Total kumulatif pemakaian query (dasar selisih per turn). */
export interface UsageTotals {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_USAGE: UsageTotals = {
  cost: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** Jumlahkan `modelUsage` pesan `result` (kumulatif, termasuk sub-agent). */
export function usageTotals(m: Record<string, unknown>): UsageTotals {
  const totals: UsageTotals = { ...ZERO_USAGE, cost: num(m.total_cost_usd) };
  const byModel = (m.modelUsage ?? {}) as Record<string, Record<string, unknown>>;
  for (const u of Object.values(byModel)) {
    totals.input += num(u?.inputTokens);
    totals.output += num(u?.outputTokens);
    totals.cacheRead += num(u?.cacheReadInputTokens);
    totals.cacheWrite += num(u?.cacheCreationInputTokens);
  }
  return totals;
}

/**
 * Pemakaian satu turn dari pesan `result`. `total_cost_usd`/`modelUsage`
 * kumulatif sepanjang proses (dan proses resume melanjutkan total
 * transcript), jadi per turn = selisih terhadap `base`. Tanpa dasar (resume
 * setelah server KCG restart) dipakai `usage` per turn — hanya loop utama,
 * tanpa biaya.
 */
export function turnUsageFrom(
  m: Record<string, unknown>,
  base: UsageTotals | null,
): { cost?: number; tokens: AgentTokenUsage } {
  if (base === null) {
    const u = (m.usage ?? {}) as Record<string, unknown>;
    return {
      tokens: {
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        reasoning: 0,
        cache: { read: num(u.cache_read_input_tokens), write: num(u.cache_creation_input_tokens) },
      },
    };
  }
  const now = usageTotals(m);
  const d = (a: number, b: number) => Math.max(0, a - b);
  return {
    cost: d(now.cost, base.cost),
    tokens: {
      input: d(now.input, base.input),
      output: d(now.output, base.output),
      reasoning: 0,
      cache: { read: d(now.cacheRead, base.cacheRead), write: d(now.cacheWrite, base.cacheWrite) },
    },
  };
}
