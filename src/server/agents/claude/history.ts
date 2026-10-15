/**
 * Transcript Claude Code (`getSessionMessages`) -> riwayat pesan KCG.
 *
 * Fungsi murni tanpa I/O, dipakai saat mengimpor Session yang dibuat di luar
 * KCG (Claude Desktop / CLI). Bentuk part-nya sama dengan hasil proyeksi
 * turn live (`ClaudeTurnTranslator` -> projector), sehingga timeline
 * merendernya persis seperti percakapan KCG:
 * - Prompt user -> pesan user (`text` + `file` untuk gambar; bytes gambar
 *   tidak disalin, hanya penanda nama file).
 * - Seluruh pesan API assistant sampai prompt berikutnya -> SATU pesan
 *   assistant (`msg_<uuid>`) berisi part `text` / `reasoning` / `tool`
 *   (`prt_<toolId>`, status dari `tool_result` yang menyusul).
 * - Pesan user buatan harness (notifikasi task, system reminder, laporan
 *   sub-agent, output command lokal) tidak ditampilkan, tapi tetap menutup
 *   turn — balasan agent sesudahnya adalah turn baru, sama seperti di live.
 * - Ringkasan compact ("This session is being continued…") -> part
 *   `compaction`.
 * - Konten sub-agent (`parent_tool_use_id`) dilewati: hasilnya sudah ada di
 *   output tool `Agent`.
 */
import type { MessagePart } from "../../../types";
import type { AgentHistoryMessage } from "../types";
import type { ClaudeTranscriptMessage } from "./sdk";
import { normalizeToolInput, toolName, toolResultText } from "./translate";

/** Blok buatan harness Claude Code di teks pesan user (bukan ketikan user). */
const HARNESS_BLOCKS =
  /<(task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g;

const COMPACT_SUMMARY = /^This session is being continued from a previous conversation/;

type Block = Record<string, unknown>;

/** Waktu pesan transcript (ms); tanpa timestamp -> `fallback`. */
function timeOf(m: ClaudeTranscriptMessage, fallback: number): number {
  const t = m.timestamp ? Date.parse(m.timestamp) : Number.NaN;
  return Number.isFinite(t) ? t : fallback;
}

function contentOf(m: ClaudeTranscriptMessage): string | Block[] {
  const content = (m.message as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content.filter((b): b is Block => typeof b === "object" && b !== null)
    : [];
}

/** `<command-name>/x</command-name><command-args>y</command-args>` -> `/x y`. */
function slashCommandText(text: string): string | null {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1]?.trim();
  if (!name) return null;
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
  const cmd = name.startsWith("/") ? name : `/${name}`;
  return args ? `${cmd} ${args}` : cmd;
}

export function historyFromTranscript(
  transcript: readonly ClaudeTranscriptMessage[],
  fallbackTime = 0,
): AgentHistoryMessage[] {
  const out: AgentHistoryMessage[] = [];
  /** Pesan assistant turn berjalan (null = turn ditutup). */
  let turn: AgentHistoryMessage | null = null;
  let ordinals = { text: 0, reasoning: 0 };
  /** Part tool yang menunggu `tool_result` (id tool call -> part). */
  const pending = new Map<string, MessagePart>();
  let lastTime = fallbackTime;

  const closeTurn = () => {
    turn = null;
  };
  const openTurn = (uuid: string, at: number): AgentHistoryMessage => {
    if (turn) return turn;
    const created: AgentHistoryMessage = {
      id: `msg_${uuid}`,
      role: "assistant",
      parts: [],
      createdAt: at,
    };
    out.push(created);
    ordinals = { text: 0, reasoning: 0 };
    turn = created;
    return created;
  };

  for (const m of transcript) {
    if (m.parent_tool_use_id) continue;
    const at = Math.max(timeOf(m, lastTime), lastTime);
    lastTime = at;
    const content = contentOf(m);

    if (m.type === "assistant") {
      if (typeof content === "string") {
        if (content.trim() === "") continue;
        const msg = openTurn(m.uuid, at);
        const id = `prt_${msg.id}_text_${ordinals.text++}`;
        msg.parts.push({ id, type: "text", text: content, time: { start: at, end: at } });
        continue;
      }
      for (const block of content) {
        if (block.type === "text" || block.type === "thinking") {
          const text = block.type === "text" ? block.text : block.thinking;
          if (typeof text !== "string" || text.trim() === "") continue;
          const kind = block.type === "text" ? "text" : "reasoning";
          const msg = openTurn(m.uuid, at);
          msg.parts.push({
            id: `prt_${msg.id}_${kind}_${ordinals[kind]++}`,
            type: kind,
            text,
            time: { start: at, end: at },
          });
        } else if (block.type === "tool_use" || block.type === "server_tool_use") {
          if (typeof block.id !== "string" || typeof block.name !== "string") continue;
          const msg = openTurn(m.uuid, at);
          const part: MessagePart = {
            id: `prt_${block.id}`,
            type: "tool",
            tool: toolName(block.name),
            callID: block.id,
            state: {
              status: "running",
              input: normalizeToolInput(block.input),
              time: { start: at },
            },
          };
          msg.parts.push(part);
          pending.set(block.id, part);
        }
      }
      continue;
    }

    if (m.type !== "user") continue;

    // Hasil tool: lengkapi part tool turn berjalan.
    if (Array.isArray(content) && content.some((b) => b.type === "tool_result")) {
      for (const block of content) {
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
        const part = pending.get(block.tool_use_id);
        if (!part) continue;
        pending.delete(block.tool_use_id);
        const output = toolResultText(block.content);
        const prev = (part.state ?? {}) as Record<string, unknown>;
        const time = { ...(prev.time as object), end: at };
        part.state =
          block.is_error === true
            ? { ...prev, status: "error", error: output || "Tool failed", output, time }
            : { ...prev, status: "completed", output, time };
      }
      continue;
    }

    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
    const raw = blocks
      .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .filter((t) => t !== "")
      .join("\n");
    const text = raw.replace(HARNESS_BLOCKS, "").trim();
    const origin = m.origin?.kind;
    const hasImage = blocks.some((b) => b.type === "image");

    if (COMPACT_SUMMARY.test(text)) {
      closeTurn();
      const msg = openTurn(m.uuid, at);
      msg.parts.push({
        id: `prt_${msg.id}_compaction_0`,
        type: "compaction",
        trigger: "auto",
        time: { created: at },
      });
      closeTurn();
      continue;
    }
    // Buatan harness: tidak tampil, tapi menutup turn.
    if ((origin !== undefined && origin !== "human") || (text === "" && !hasImage)) {
      closeTurn();
      continue;
    }

    const parts: MessagePart[] = [];
    const display = slashCommandText(text) ?? text;
    if (display !== "") parts.push({ type: "text", text: display });
    let images = 0;
    for (const b of blocks) {
      if (b.type !== "image") continue;
      const source = (b.source ?? {}) as { media_type?: unknown };
      const mime = typeof source.media_type === "string" ? source.media_type : "image/png";
      images += 1;
      parts.push({
        type: "file",
        mime,
        filename: `image-${images}.${mime.split("/")[1] ?? "png"}`,
      });
    }
    closeTurn();
    out.push({ id: `usr_${m.uuid}`, role: "user", parts, createdAt: at });
  }

  // Tool tanpa hasil (turn terputus / masih berjalan di tempat lain).
  for (const part of pending.values()) {
    const prev = (part.state ?? {}) as Record<string, unknown>;
    part.state = { ...prev, status: "error", error: "No result was recorded for this tool call." };
  }
  return out;
}
