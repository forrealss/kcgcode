/**
 * Pemakaian context window opencode: token step terakhir per Session + batas
 * context model (dari daftar model) untuk menghitung persentase.
 */
import type { ContextUsage } from "../../../types";
import type { AgentEvent } from "../types";
import { rec } from "./util";

/** Jeda minimum memuat ulang batas context model yang belum dikenal. */
const LIMITS_RELOAD_MS = 5 * 60_000;

/** Token context window dari usage step (input + output + reasoning + cache). */
export function stepContextTokens(tokens: unknown): number | null {
  const t = rec(tokens);
  const cache = rec(t.cache);
  const parts = [t.input, t.output, t.reasoning, cache.read, cache.write];
  if (!parts.some((v) => typeof v === "number")) return null;
  return parts.reduce<number>((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
}

export class OpencodeUsage {
  /** Model step terakhir per Session opencode (`provider/id`). */
  private readonly stepModels = new Map<string, { id: string; providerID: string }>();
  /** Token context step terakhir per Session opencode. */
  private readonly stepTokens = new Map<string, { tokens: number; at: number }>();
  /** Batas context window per model (`provider/id`), dari daftar model. */
  private readonly contextLimits = new Map<string, number>();
  private limitsLoadedAt = 0;

  /**
   * Pemakaian context opencode = token step terakhir (bukan total Session).
   * Setelah compact angka lama tidak berlaku sampai step berikutnya.
   */
  track(ev: AgentEvent): void {
    if (ev.type === "session.step.started" && ev.data.model) {
      this.stepModels.set(ev.data.sessionID, ev.data.model);
    } else if (ev.type === "session.step.ended") {
      const tokens = stepContextTokens((ev.data as { tokens?: unknown }).tokens);
      if (tokens !== null) this.stepTokens.set(ev.data.sessionID, { tokens, at: Date.now() });
    } else if (ev.type === "agent.compaction" && ev.data.phase === "ended") {
      const before = this.stepTokens.get(ev.data.sessionID);
      if (before) ev.data.preTokens = before.tokens;
      this.stepTokens.delete(ev.data.sessionID);
    }
  }

  /** Catat batas context model (`provider/id`) dari daftar model. */
  setContextLimit(key: string, limit: number): void {
    this.contextLimits.set(key, limit);
  }

  /** Daftar model selesai dimuat (dasar pembatas frekuensi muat ulang). */
  markLimitsLoaded(): void {
    this.limitsLoadedAt = Date.now();
  }

  /** Pemakaian terakhir Session; `loadLimits` memuat daftar model bila batasnya belum dikenal. */
  async contextUsage(
    sessionID: string,
    loadLimits: () => Promise<unknown>,
  ): Promise<ContextUsage | null> {
    const used = this.stepTokens.get(sessionID);
    if (!used) return null;
    const model = this.stepModels.get(sessionID);
    const key = model ? `${model.providerID}/${model.id}` : null;
    // Batas model belum dikenal -> muat daftar model (dibatasi frekuensinya).
    if (
      key &&
      !this.contextLimits.has(key) &&
      Date.now() - this.limitsLoadedAt > LIMITS_RELOAD_MS
    ) {
      await loadLimits();
    }
    const max = key ? (this.contextLimits.get(key) ?? null) : null;
    return {
      usedTokens: used.tokens,
      maxTokens: max,
      percent: max ? Math.round((used.tokens / max) * 100) : null,
      autoCompactAt: null,
      model: model?.id ?? null,
      categories: [],
      measuredAt: used.at,
    };
  }
}
