/**
 * Formatter output tool: konten hasil tool -> teks yang disimpan di part.
 */
import type { AgentToolContent } from "../../agents/types";

/** Batas panjang output tool yang disimpan (hindari blob raksasa di DB). */
export const TOOL_OUTPUT_MAX_LENGTH = 50_000;

/** Teks dari konten hasil tool, dipotong bila terlalu panjang. */
export function toolContentText(content: readonly AgentToolContent[] | undefined): string {
  const text = (content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : c.type === "image" ? "[image]" : ""))
    .filter((s) => s !== "")
    .join("\n");
  return text.length > TOOL_OUTPUT_MAX_LENGTH
    ? `${text.slice(0, TOOL_OUTPUT_MAX_LENGTH)}\n… (truncated)`
    : text;
}
