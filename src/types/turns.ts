/**
 * Model tampilan percakapan (timeline SessionView).
 *
 * Tipe-tipe ini adalah hasil transformasi `SessionMessage` menjadi segmen /
 * kelompok yang siap dirender — transformasinya (fungsi murni, teruji lewat
 * `bun test`) hidup di `src/lib/turns.ts`, sedangkan konsumen render berada
 * di `src/components/sessions/`.
 */
import type { MessagePart, SessionMessage } from "./message";

/** Satu segmen render turn assistant (urut sesuai alur kerja model). */
export type TurnSegment =
  | { kind: "reasoning"; key: string; part: MessagePart }
  | { kind: "tool"; key: string; part: MessagePart }
  | { kind: "error"; key: string; part: MessagePart }
  | {
      kind: "text";
      key: string;
      text: string /** Jawaban akhir turn (bukan interim). */;
      final: boolean;
    };

/**
 * Kelompokkan segmen satu turn menjadi blok berurutan untuk render in-order.
 * Setiap blok berisi kluster steps (reasoning/tool) opsional diikuti teks/error
 * opsional. Ini memungkinkan pola multi-round:
 *   [thinking] → [text] → [thinking] → [text]
 * dirender sebagai beberapa "Thought process" terpisah, bukan satu blok di atas.
 */
export interface TurnBlock {
  /** Key unik blok (dari key segmen pertama). */
  key: string;
  steps: Extract<TurnSegment, { kind: "reasoning" | "tool" }>[];
  /** Teks atau error setelah kluster steps ini (bisa null kalau blok masih streaming). */
  content: Extract<TurnSegment, { kind: "text" | "error" }> | null;
}

/** Sekelompok pesan assistant berurutan dari satu turn balasan model. */
export interface AssistantTurnGroup {
  kind: "assistant";
  /** Id pesan pertama — dipakai sebagai key React & key collapsible turn. */
  id: string;
  messages: SessionMessage[];
}

/** Kelompok pesan untuk render timeline: user selalu sendiri, assistant satu turn. */
export type MessageGroup = { kind: "user"; message: SessionMessage } | AssistantTurnGroup;
