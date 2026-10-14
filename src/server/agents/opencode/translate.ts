/**
 * Event opencode v2 (`@opencode/client` `event.subscribe`) -> `AgentEvent`.
 *
 * Lapisan agent KCG mengacu ke bentuk event v2, jadi event diteruskan hampir
 * apa adanya: hanya jenis yang dipakai KCG yang dilewatkan, `data` disalin
 * dengan field yang dikenal, dan `form.created` dinormalkan ke `AgentForm`.
 */
import type { AgentEvent, AgentEventType, AgentForm, AgentFormField } from "../types";

/** Jenis event v2 yang diteruskan apa adanya (bentuk `data` identik). */
const PASS_THROUGH = new Set<AgentEventType>([
  "session.created",
  "session.renamed",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.delta",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.retry.scheduled",
  "permission.asked",
  "permission.replied",
  "form.replied",
  "form.cancelled",
]);

type Raw = { type?: unknown; data?: unknown; location?: unknown };

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Direktori event (v2 `location.directory`) bila ada. */
export function eventDirectory(raw: unknown): string | undefined {
  const loc = asRecord(asRecord(raw)?.location);
  const dir = loc?.directory;
  return typeof dir === "string" && dir !== "" ? dir : undefined;
}

/** Normalisasi `FormInfo` v2 ke `AgentForm`. */
export function toAgentForm(raw: unknown): AgentForm | null {
  const f = asRecord(raw);
  if (!f || typeof f.id !== "string" || typeof f.sessionID !== "string") return null;
  const fields: AgentFormField[] = [];
  for (const item of Array.isArray(f.fields) ? f.fields : []) {
    const fld = asRecord(item);
    if (!fld || typeof fld.key !== "string" || typeof fld.type !== "string") continue;
    const options = Array.isArray(fld.options)
      ? fld.options
          .map(asRecord)
          .filter((o): o is Record<string, unknown> => o !== null && typeof o.label === "string")
          .map((o) => ({
            value: typeof o.value === "string" ? o.value : (o.label as string),
            label: o.label as string,
            ...(typeof o.description === "string" ? { description: o.description } : {}),
          }))
      : undefined;
    fields.push({
      key: fld.key,
      type: fld.type,
      ...(typeof fld.title === "string" ? { title: fld.title } : {}),
      ...(typeof fld.description === "string" ? { description: fld.description } : {}),
      ...(options ? { options } : {}),
      ...(typeof fld.custom === "boolean" ? { custom: fld.custom } : {}),
      ...(typeof fld.required === "boolean" ? { required: fld.required } : {}),
      ...(typeof fld.hidden === "boolean" ? { hidden: fld.hidden } : {}),
    });
  }
  if (fields.length === 0) return null;
  return {
    id: f.id,
    sessionID: f.sessionID,
    title: typeof f.title === "string" ? f.title : "Question",
    fields,
    ...(asRecord(f.metadata) ? { metadata: f.metadata as Record<string, unknown> } : {}),
  };
}

/** Terjemahkan satu event v2; `null` = tidak dipakai KCG. */
export function translateOpencodeEvent(raw: unknown): AgentEvent | null {
  const r = asRecord(raw) as Raw | null;
  if (!r || typeof r.type !== "string") return null;
  const data = asRecord(r.data);
  if (!data) return null;
  const directory = eventDirectory(raw);
  const location = directory ? { location: { directory } } : {};
  if (r.type === "form.created") {
    const form = toAgentForm(data.form);
    return form ? { type: "form.created", data: { form }, ...location } : null;
  }
  if (!PASS_THROUGH.has(r.type as AgentEventType)) return null;
  // `sessionID` wajib untuk perutean ke Session lokal.
  if (typeof data.sessionID !== "string") return null;
  return { type: r.type, data, ...location } as AgentEvent;
}
