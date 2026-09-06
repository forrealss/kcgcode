/**
 * Transformasi pesan percakapan terstruktur → model tampilan timeline.
 *
 * Logika murni (tanpa React/DOM) yang sebelumnya tinggal di `SessionView.tsx`,
 * dipisah agar dapat diuji `bun test` tanpa render. Tipe hasil (`TurnSegment`,
 * `TurnBlock`, `MessageGroup`, dst.) ada di `src/types/turns.ts`.
 */
import type {
  AssistantTurnGroup,
  MessageGroup,
  MessagePart,
  SessionMessage,
  TurnBlock,
  TurnSegment,
} from "@/types";

/** Teks part apa pun yang membawa field `text` (atau null). */
export function partText(p: MessagePart): string | null {
  return typeof p.text === "string" ? p.text : null;
}

/**
 * Gabungkan teks jawaban dari part `text` saja — reasoning/tool/step tidak
 * ikut, walau part tersebut juga membawa field `text` dari opencode.
 */
export function textOf(parts: MessagePart[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map(partText)
    .filter((t): t is string => t !== null)
    .join("\n");
}

/**
 * Ratakan seluruh parts satu turn (bisa beberapa pesan assistant) menjadi
 * daftar segmen BERURUTAN: setiap part reasoning jadi satu segmen Thinking
 * tersendiri (bisa tampil lebih dari sekali, sesuai urutan berpikir model),
 * tool jadi segmen badge, part `text` berurutan digabung, dan segmen teks
 * non-kosong TERAKHIR ditandai `final` (jawaban akhir — satu-satunya yang
 * dapat efek typewriter).
 */
export function turnSegments(messages: readonly SessionMessage[]): TurnSegment[] {
  const segments: TurnSegment[] = [];
  for (const msg of messages) {
    msg.parts.forEach((part, i) => {
      const key = `${msg.id}:${part.id ?? i}`;
      if (part.type === "reasoning" || part.type === "error") {
        segments.push({ kind: part.type, key, part });
        return;
      }
      if (part.type === "tool" || part.type === "shell" || part.type === "file") {
        segments.push({ kind: "tool", key, part });
        return;
      }
      if (part.type !== "text") return;
      const text = partText(part) ?? "";
      const last = segments[segments.length - 1];
      // Part text berdempetan digabung agar tidak pecah jadi beberapa bubble.
      if (last?.kind === "text") last.text = last.text === "" ? text : `${last.text}\n${text}`;
      else segments.push({ kind: "text", key, text, final: false });
    });
  }
  // Segmen teks non-kosong terakhir = jawaban akhir turn.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg?.kind !== "text") continue;
    if (seg.text.trim() !== "") seg.final = true;
    break;
  }
  return segments;
}

/** Key kandidat `state.input` tool yang berisi target utama (path/argumen). */
const TOOL_TARGET_KEYS = [
  "filePath",
  "path",
  "file",
  "dir",
  "directory",
  "pattern",
  "query",
  "url",
  "command",
  "description",
] as const;

/**
 * Target utama sebuah tool call (mis. path file yang di-read) — diambil
 * dari `state.input` part tool opencode dengan toleransi beberapa nama key.
 * Part `file` (echo @file) memakai `filename`-nya langsung.
 */
export function toolTarget(part: MessagePart): string | null {
  if (part.type === "file" && typeof part.filename === "string" && part.filename.trim() !== "") {
    return part.filename;
  }
  const state = part.state;
  if (typeof state !== "object" || state === null) return null;
  const input = (state as { input?: unknown }).input;
  if (typeof input !== "object" || input === null) return null;
  for (const key of TOOL_TARGET_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/** Label badge tool: nama tool + target (mis. `read package.json`). */
export function toolLabel(part: MessagePart): string {
  const name = typeof part.tool === "string" && part.tool.trim() !== "" ? part.tool : part.type;
  const target = toolTarget(part);
  return target === null ? name : `${name} ${target}`;
}

/**
 * Kelompokkan pesan berurutan: assistant yang berdempetan (satu turn —
 * sering dipecah opencode menjadi beberapa `msg_...` saat reasoning/tool/
 * sub-agent) menjadi SATU grup sehingga tampil sebagai satu kesatuan;
 * pesan user selalu grup tersendiri.
 */
export function groupTurns(messages: readonly SessionMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (m.role === "assistant") {
      if (last?.kind === "assistant") last.messages.push(m);
      else groups.push({ kind: "assistant", id: m.id, messages: [m] });
    } else {
      groups.push({ kind: "user", message: m });
    }
  }
  return groups;
}

/**
 * Apakah satu turn sudah menampilkan sesuatu ke user: reasoning non-kosong,
 * tool call, error, maupun teks. Dipakai untuk memutuskan kapan indikator
 * "Memproses…" perlu tampil (respon masih kosong sama sekali).
 */
export function hasVisibleContent(segments: readonly TurnSegment[]): boolean {
  return segments.some(
    (s) =>
      s.kind === "tool" ||
      s.kind === "error" ||
      (s.kind === "reasoning" && (partText(s.part) ?? "").trim() !== "") ||
      (s.kind === "text" && s.text.trim() !== ""),
  );
}

/**
 * Status LIVE satu turn untuk maskot (murni, diuji):
 * - `null`       -> turn belum ada / selesai (maskot disembunyikan).
 * - "Working…"   -> belum ada konten apa pun (baru mulai).
 * - "Thinking…"  -> reasoning part terakhir masih berjalan.
 * - "Writing…"   -> model sedang menulis jawaban (segmen teks terakhir tampil).
 * - lainnya      -> label tool yang sedang dijalankan (mis. "read package.json").
 *
 * Catatan: akhir turn ditandai `streaming=false` (pesan final menggantikan
 * versi streaming), jadi penilaian "selesai" cukup dari flag itu.
 */
export function turnStatus(messages: readonly SessionMessage[], streaming: boolean): string | null {
  if (!streaming || messages.length === 0) return null;
  const segments = turnSegments(messages);
  if (!hasVisibleContent(segments)) return "Working…";
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!seg) continue;
    if (seg.kind === "text") return "Writing…";
    if (seg.kind === "reasoning") return "Thinking…";
    if (seg.kind === "tool") return toolLabel(seg.part);
    // error: proses berhenti di error -> selesai.
    return null;
  }
  return "Working…";
}

/**
 * Total durasi thinking (ms) dari satu turn — dipakai untuk label "thoughts Xs"
 * di footer setelah turn selesai.
 *
 * Strategi (urut prioritas):
 * 1. Pakai `time.start`/`time.end` dari `ReasoningPart` asli opencode jika ada.
 * 2. Fallback ke `time.start` part pertama vs `time.end` part terakhir dari
 *    seluruh parts reasoning yang ada (estimasi kasar).
 * 3. Jika tidak ada timing sama sekali, kembalikan null.
 */
export function turnThoughtDuration(messages: readonly SessionMessage[]): number | null {
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "reasoning") continue;
      const t = part.time;
      if (!t) continue;
      const start = t.start ?? t.created;
      if (typeof start === "number") {
        if (earliest === null || start < earliest) earliest = start;
      }
      const end = t.end;
      if (typeof end === "number") {
        if (latest === null || end > latest) latest = end;
      }
    }
  }
  if (earliest !== null && latest !== null && latest > earliest) {
    return latest - earliest;
  }
  return null;
}

export function turnBlocks(segments: readonly TurnSegment[]): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let pendingSteps: Extract<TurnSegment, { kind: "reasoning" | "tool" }>[] = [];

  for (const seg of segments) {
    if (seg.kind === "reasoning" || seg.kind === "tool") {
      pendingSteps.push(seg);
    } else if (seg.kind === "text" || seg.kind === "error") {
      blocks.push({
        key: pendingSteps[0]?.key ?? seg.key,
        steps: pendingSteps,
        content: seg,
      });
      pendingSteps = [];
    }
  }
  // Steps tersisa tanpa teks (masih streaming atau turn selesai tanpa teks akhir)
  const firstPending = pendingSteps[0];
  if (firstPending) {
    blocks.push({ key: firstPending.key, steps: pendingSteps, content: null });
  }
  return blocks;
}

/**
 * Upsert satu part ke dalam daftar pesan (streaming, event `message_part`).
 * - Belum ada pesan dengan `messageId` -> buat placeholder assistant streaming.
 * - Sudah ada -> part dengan `id` sama diganti, selainnya ditambahkan.
 * Mengembalikan array baru (immutable) agar mudah diverifikasi.
 */
export function upsertMessagePart(
  messages: SessionMessage[],
  sessionId: string,
  messageId: string,
  part: MessagePart,
): SessionMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) {
    return [
      ...messages,
      {
        id: messageId,
        sessionId,
        role: "assistant",
        parts: [part],
        createdAt: Date.now(),
        streaming: true,
      },
    ];
  }
  const cur = messages[idx];
  if (!cur) return messages;
  const partIdx = cur.parts.findIndex((p) => p.id !== undefined && p.id === part.id);
  const nextParts =
    partIdx === -1 ? [...cur.parts, part] : cur.parts.map((p, i) => (i === partIdx ? part : p));
  const next: SessionMessage = { ...cur, parts: nextParts, streaming: true };
  return messages.map((m, i) => (i === idx ? next : m));
}

/**
 * Ganti pesan final (hasil POST, non-streaming) — replace bila id sama
 * (menutup versi streaming), selainnya tambahkan.
 */
export function upsertMessage(
  messages: SessionMessage[],
  message: SessionMessage,
): SessionMessage[] {
  const idx = messages.findIndex((m) => m.id === message.id);
  if (idx === -1) return [...messages, message];
  return messages.map((m, i) => (i === idx ? message : m));
}

/** Grup assistant terakhir dalam daftar grup (dipakai status maskot global). */
export function lastAssistantGroup(groups: readonly MessageGroup[]): AssistantTurnGroup | null {
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g?.kind === "assistant") return g;
  }
  return null;
}
