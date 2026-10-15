/**
 * Pemakaian context window & compact — logika tampilan murni (tanpa DOM),
 * diuji `bun test`. Dipakai panel konteks (meter pemakaian) dan timeline
 * (penanda "conversation compacted").
 */
import type { MessagePart } from "@/types";

/** Jumlah token ringkas: `950`, `3.8k`, `167k`, `1M`, `1.5M`. */
export function formatTokens(n: number): string {
  const strip = (s: string) => s.replace(/\.0$/, "");
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${strip((n / 1000).toFixed(n < 100_000 ? 1 : 0))}k`;
  return `${strip((n / 1_000_000).toFixed(1))}M`;
}

/** Tingkat pemakaian untuk warna meter (pola AdwLevelBar low/high/full). */
export type UsageLevel = "normal" | "warning" | "critical";

export function usageLevel(percent: number | null): UsageLevel {
  if (percent === null) return "normal";
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "normal";
}

/**
 * Teks penanda compact di timeline, mis.
 * "Conversation compacted · 33.3k → 3.8k tokens" (auto: "Context auto-compacted").
 */
export function compactionLabel(part: MessagePart): string {
  const title = part.trigger === "auto" ? "Context auto-compacted" : "Conversation compacted";
  const pre = typeof part.preTokens === "number" ? part.preTokens : null;
  const post = typeof part.postTokens === "number" ? part.postTokens : null;
  if (pre !== null && post !== null) {
    return `${title} · ${formatTokens(pre)} → ${formatTokens(post)} tokens`;
  }
  if (pre !== null) return `${title} · from ${formatTokens(pre)} tokens`;
  return title;
}
