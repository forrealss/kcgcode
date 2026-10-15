/**
 * Riwayat pesan Session opencode v2 (`message.list`) -> riwayat pesan KCG.
 *
 * Fungsi murni tanpa I/O, dipakai saat mengimpor Session yang dibuat di luar
 * KCG (TUI / desktop opencode). Bentuk part-nya sama dengan hasil proyeksi
 * event live (`agent-projector`), sehingga timeline merendernya persis
 * seperti percakapan KCG:
 * - Pesan `user` -> pesan user (`text` + `file`; bytes lampiran inline tidak
 *   disalin, hanya penanda nama file).
 * - Tiap pesan `assistant` (satu step opencode) -> SATU pesan assistant
 *   dengan id yang sama seperti live (`assistantMessageID`): part
 *   `prt_<msg>_text_<n>` / `prt_<msg>_reasoning_<n>` dan tool `prt_<callId>`.
 *   Reasoning terenkripsi (teks kosong) tidak menjadi part. Error selain
 *   abort -> pesan error tersendiri, seperti penutupan turn yang gagal
 *   (juga `idle` gagal tanpa step, mis. model tidak tersedia).
 * - Compact selesai -> part `compaction`; shell `!cmd` dari TUI -> part tool
 *   `shell`.
 * - Pesan buatan harness (`synthetic` hasil `@file`, `system`, skill,
 *   pergantian agent/model/lokasi) tidak ditampilkan.
 * - Sub-agent (`task`) hidup di Session anak sendiri: cukup output tool-nya.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MessagePart } from "../../../types";
import { toolContentText } from "../../services/projector/tool-output";
import type { AgentHistoryMessage, AgentToolContent } from "../types";
import { type Rec, rec, str } from "./util";

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function toolContent(v: unknown): AgentToolContent[] {
  return Array.isArray(v) ? (v.filter((c) => rec(c).type) as AgentToolContent[]) : [];
}

/** Konten `tool` pesan assistant -> part tool KCG (status akhir). */
function toolPart(c: Rec, at: number): MessagePart | null {
  const id = str(c.id);
  const name = str(c.name);
  if (!id || !name) return null;
  const state = rec(c.state);
  const time = rec(c.time);
  const start = num(time.created) ?? at;
  const end = num(time.completed) ?? num(time.ran) ?? start;
  const input = rec(state.input);
  const metadata = Object.keys(rec(state.metadata)).length > 0 ? { metadata: state.metadata } : {};
  const output = toolContentText(toolContent(state.content));
  let partState: Record<string, unknown>;
  if (state.status === "completed") {
    partState = { status: "completed", input, output, ...metadata, time: { start, end } };
  } else if (state.status === "error") {
    partState = {
      status: "error",
      input,
      error: str(rec(state.error).message) ?? "Tool failed",
      ...(output ? { output } : {}),
      ...metadata,
      time: { start, end },
    };
  } else {
    // streaming / running: turn terputus sebelum tool selesai.
    partState = {
      status: "error",
      input,
      error: "No result was recorded for this tool call.",
      time: { start },
    };
  }
  return { id: `prt_${id}`, type: "tool", tool: name, callID: id, state: partState };
}

function assistantMessage(m: Rec, id: string, at: number): AgentHistoryMessage[] {
  const end = num(rec(m.time).completed) ?? at;
  const parts: MessagePart[] = [];
  const ordinals = { text: 0, reasoning: 0 };
  for (const item of Array.isArray(m.content) ? m.content : []) {
    const c = rec(item);
    if (c.type === "text" || c.type === "reasoning") {
      const kind = c.type;
      const text = typeof c.text === "string" ? c.text : "";
      const n = ordinals[kind]++;
      if (text.trim() === "") continue;
      parts.push({ id: `prt_${id}_${kind}_${n}`, type: kind, text, time: { start: at, end } });
    } else if (c.type === "tool") {
      const part = toolPart(c, at);
      if (part) parts.push(part);
    }
  }
  const out: AgentHistoryMessage[] = [];
  if (parts.length > 0) out.push({ id, role: "assistant", parts, createdAt: at });
  const err = errorMessage(m.error, id, end);
  if (err) out.push(err);
  return out;
}

/** Error eksekusi (selain abort) -> pesan error tersendiri seperti live. */
function errorMessage(error: unknown, id: string, at: number): AgentHistoryMessage | null {
  const err = rec(error);
  if (Object.keys(err).length === 0 || err.type === "aborted") return null;
  const text = str(err.message)?.split("\n")[0]?.trim() || "Something went wrong.";
  return { id: `err_${id}`, role: "assistant", parts: [{ type: "error", text }], createdAt: at };
}

function userMessage(m: Rec, id: string, at: number): AgentHistoryMessage | null {
  const parts: MessagePart[] = [];
  const text = typeof m.text === "string" ? m.text.trim() : "";
  if (text !== "") parts.push({ type: "text", text });
  let n = 0;
  for (const item of Array.isArray(m.files) ? m.files : []) {
    const f = rec(item);
    const mime = str(f.mime) ?? "application/octet-stream";
    n += 1;
    const uri = str(rec(f.source).uri);
    const local = uri?.startsWith("file:") ? uri : null;
    parts.push({
      type: "file",
      mime,
      filename:
        str(f.name) ??
        (local ? path.basename(fileURLToPath(local)) : `file-${n}.${mime.split("/")[1] ?? "bin"}`),
      ...(local ? { url: local } : {}),
    });
  }
  return parts.length > 0 ? { id, role: "user", parts, createdAt: at } : null;
}

function shellMessage(m: Rec, id: string, at: number): AgentHistoryMessage | null {
  const command = str(m.command);
  if (!command) return null;
  const end = num(rec(m.time).completed) ?? at;
  const output = typeof rec(m.output).output === "string" ? (rec(m.output).output as string) : "";
  const exit = m.exit;
  const ok = m.status === "exited" && (exit === undefined || exit === 0);
  const state = ok
    ? { status: "completed", input: { command }, output, time: { start: at, end } }
    : {
        status: "error",
        input: { command },
        error:
          m.status === "running"
            ? "No result was recorded for this command."
            : `Command ${m.status === "exited" ? `exited with code ${String(exit)}` : m.status}.`,
        ...(output ? { output } : {}),
        time: { start: at, end },
      };
  return {
    id,
    role: "assistant",
    parts: [{ id: `prt_${id}_shell`, type: "tool", tool: "shell", callID: id, state }],
    createdAt: at,
  };
}

export function historyFromMessages(messages: readonly unknown[]): AgentHistoryMessage[] {
  const out: AgentHistoryMessage[] = [];
  let lastTime = 0;
  for (const raw of messages) {
    const m = rec(raw);
    const id = str(m.id);
    if (!id) continue;
    // Waktu tidak boleh mundur (urutan timeline mengikuti createdAt).
    const at = Math.max(num(rec(m.time).created) ?? lastTime, lastTime);
    lastTime = at;
    switch (m.type) {
      case "user": {
        const msg = userMessage(m, id, at);
        if (msg) out.push(msg);
        break;
      }
      case "assistant":
        out.push(...assistantMessage(m, id, at));
        break;
      case "compaction":
        if (m.status !== "completed") break;
        out.push({
          id,
          role: "assistant",
          parts: [
            {
              id: `prt_${id}_compaction_0`,
              type: "compaction",
              trigger: m.reason === "manual" ? "manual" : "auto",
              time: { created: at },
            },
          ],
          createdAt: at,
        });
        break;
      case "shell": {
        const msg = shellMessage(m, id, at);
        if (msg) out.push(msg);
        break;
      }
      case "idle": {
        // Eksekusi gagal sebelum ada step (mis. model tidak tersedia); error
        // step terakhir yang sama sudah tercatat di pesan assistant-nya.
        const err = m.outcome === "failed" ? errorMessage(m.error, id, at) : null;
        const last = out.at(-1);
        if (err && !(last?.parts.length === 1 && last.parts[0]?.type === "error")) out.push(err);
        break;
      }
      default:
        // synthetic / system / skill / *-switched: buatan harness.
        break;
    }
  }
  return out;
}
