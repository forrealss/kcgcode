/**
 * Sub-agent & pemakaian turn — logika tampilan murni (tanpa DOM), diuji
 * `bun test`.
 *
 * Bentuk data dari server (`agent-projector`):
 * - Tool call sub-agent = part `tool` dengan `tool: "task"` (Claude `Agent`,
 *   opencode `task`); `state.input` berisi `subagent_type`, `description`,
 *   `prompt`.
 * - Konten kerja sub-agent = part apa pun yang membawa `parentToolID` (id
 *   tool call di atas) — bisa tersebar di pesan/turn berbeda (sub-agent
 *   latar belakang bekerja saat agent utama idle).
 * - Status/statistik = part `subagent` (`toolID`, `status`, `tokens`, …);
 *   yang PALING AKHIR dalam urutan pesan berlaku.
 * - Pemakaian turn = part `usage` (`cost`, `tokens`).
 */
import type { MessagePart, SessionMessage } from "@/types";

export type SubagentStatus = "running" | "completed" | "failed" | "stopped";

/** Info terbaru + konten kerja satu sub-agent. */
export interface SubagentEntry {
  /** Part `subagent` terakhir; null bila agent tidak melaporkannya. */
  info: MessagePart | null;
  /** Part konten milik sub-agent (berurutan). */
  parts: MessagePart[];
}

/** Indeks sub-agent per id tool call. */
export type SubagentIndex = ReadonlyMap<string, SubagentEntry>;

/** Part `tool` yang memanggil sub-agent. */
export function isSubagentTool(part: MessagePart): boolean {
  return part.type === "tool" && part.tool === "task";
}

/** Part metadata yang tidak dirender di timeline (`subagent`, `usage`). */
export function isMetaPart(part: MessagePart): boolean {
  return part.type === "subagent" || part.type === "usage";
}

/** Kelompokkan info & konten sub-agent dari seluruh pesan Session. */
export function indexSubagents(messages: readonly SessionMessage[]): Map<string, SubagentEntry> {
  const index = new Map<string, SubagentEntry>();
  const entry = (id: string) => {
    let e = index.get(id);
    if (!e) {
      e = { info: null, parts: [] };
      index.set(id, e);
    }
    return e;
  };
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "subagent" && typeof part.toolID === "string") {
        entry(part.toolID).info = part;
      } else if (part.type !== "usage" && typeof part.parentToolID === "string") {
        entry(part.parentToolID).parts.push(part);
      }
    }
  }
  return index;
}

/** Tampilan satu sub-agent (kartu & detail). */
export interface SubagentView {
  toolID: string;
  agentType: string | null;
  description: string | null;
  /** Instruksi yang diberikan agent utama. */
  prompt: string | null;
  status: SubagentStatus;
  tokens: number | null;
  toolUses: number;
  durationMs: number | null;
  /** Tool terakhir yang dijalankan (status live). */
  lastTool: string | null;
  /** Ringkasan / hasil akhir sub-agent. */
  result: string | null;
  /** Langkah kerja (reasoning, tool, teks) berurutan. */
  steps: MessagePart[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

const STATUSES = new Set<SubagentStatus>(["running", "completed", "failed", "stopped"]);

/**
 * Gabungkan tool call, info terbaru, dan konten sub-agent. Status dari info
 * agent didahulukan — tool `Agent` Claude yang berjalan di latar belakang
 * langsung "selesai" (hanya meluncurkan), padahal sub-agent masih bekerja.
 */
export function subagentView(tool: MessagePart, entry: SubagentEntry | undefined): SubagentView {
  const state = (tool.state ?? {}) as Record<string, unknown>;
  const input = (state.input ?? {}) as Record<string, unknown>;
  const info = (entry?.info ?? {}) as Record<string, unknown>;
  const steps = entry?.parts ?? [];
  const ownTools = steps.filter((p) => p.type === "tool");

  const infoStatus = info.status as SubagentStatus | undefined;
  const status: SubagentStatus =
    infoStatus && STATUSES.has(infoStatus)
      ? infoStatus
      : state.status === "error"
        ? "failed"
        : state.status === "completed"
          ? "completed"
          : "running";

  const time = (state.time ?? {}) as { start?: number; end?: number };
  const toolDuration =
    typeof time.start === "number" && typeof time.end === "number" ? time.end - time.start : null;

  const lastText = [...steps].reverse().find((p) => p.type === "text" && str(p.text));
  // Output tool `Agent` latar belakang = metadata internal peluncuran, bukan hasil.
  const output = info.background === true ? null : str(state.output);

  return {
    toolID: (str(tool.callID) ?? str(tool.id) ?? "") as string,
    agentType: str(info.agentType) ?? str(input.subagent_type),
    description: str(input.description) ?? str(info.description),
    prompt: str(input.prompt),
    status,
    tokens: num(info.tokens),
    toolUses: num(info.toolUses) ?? ownTools.length,
    durationMs: num(info.durationMs) ?? toolDuration,
    lastTool: str(info.lastTool) ?? str(ownTools.at(-1)?.tool),
    result: str(info.summary) ?? output ?? str(lastText?.text),
    steps,
  };
}

/** Pemakaian satu turn (jumlah part `usage`). */
export interface TurnUsage {
  /** Total token diproses (input + output + reasoning + cache). */
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Estimasi biaya USD; null bila agent tidak melaporkannya. */
  cost: number | null;
}

/** Jumlahkan part `usage` pesan-pesan satu turn; null bila tidak ada pemakaian. */
export function turnUsage(messages: readonly SessionMessage[]): TurnUsage | null {
  const sum: TurnUsage = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null };
  let found = false;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "usage") continue;
      const t = (part.tokens ?? {}) as Record<string, unknown>;
      const cache = (t.cache ?? {}) as Record<string, unknown>;
      const n = (v: unknown) => (typeof v === "number" ? v : 0);
      sum.input += n(t.input);
      sum.output += n(t.output) + n(t.reasoning);
      sum.cacheRead += n(cache.read);
      sum.cacheWrite += n(cache.write);
      if (typeof part.cost === "number") sum.cost = (sum.cost ?? 0) + part.cost;
      found = true;
    }
  }
  sum.total = sum.input + sum.output + sum.cacheRead + sum.cacheWrite;
  return found && sum.total > 0 ? sum : null;
}

/** Biaya ringkas: `$1.23`, `$0.014`, `<$0.01`. */
export function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(3).replace(/0$/, "")}`;
  return `$${usd.toFixed(2)}`;
}
