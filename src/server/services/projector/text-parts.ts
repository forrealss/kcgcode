/**
 * Part text/reasoning: text/reasoning ke-`ordinal` pesan `M` -> part
 * `prt_M_text_<n>` / `prt_M_reasoning_<n>`. Part dikirim saat token pertama
 * (reasoning yang disembunyikan provider tidak menjadi part kosong), delta
 * diteruskan sebagai `message.part.delta` field `text`, dan `*.ended`
 * membawa teks final yang otoritatif.
 */
import type { AgentEventData } from "../../agents/types";
import type { ProjectorContext } from "./types";

export type TextKind = "text" | "reasoning";

export function textStarted(
  ctx: ProjectorContext,
  data: AgentEventData<"session.text.started">,
  kind: TextKind,
): void {
  const state = ctx.messages.message(data.sessionID, data.assistantMessageID);
  if (!state) return;
  const id = `prt_${data.assistantMessageID}_${kind}_${data.ordinal}`;
  if (state.parts.has(id)) return;
  // Belum dikirim: menunggu token pertama.
  state.parts.set(id, {
    id,
    type: kind,
    text: "",
    time: { start: ctx.opts.now() },
    ...ctx.subagents.parentField(data.sessionID, data.parentToolID),
  });
}

export function textDelta(
  ctx: ProjectorContext,
  data: AgentEventData<"session.text.delta">,
  kind: TextKind,
): void {
  if (data.delta === "") return;
  const state = ctx.messages.message(data.sessionID, data.assistantMessageID);
  if (!state) return;
  const id = `prt_${data.assistantMessageID}_${kind}_${data.ordinal}`;
  const part = state.parts.get(id) ?? {
    id,
    type: kind,
    text: "",
    time: { start: ctx.opts.now() },
    ...ctx.subagents.parentField(data.sessionID, data.parentToolID),
  };
  if (!state.emitted.has(id)) {
    state.emitted.add(id);
    ctx.messages.put(state, data.assistantMessageID, part);
  }
  state.parts.set(id, { ...part, text: `${part.text ?? ""}${data.delta}` });
  ctx.opts.turns.acceptDelta(state.sessionId, data.assistantMessageID, id, "text", data.delta);
}

export function textEnded(
  ctx: ProjectorContext,
  data: AgentEventData<"session.text.ended">,
  kind: TextKind,
): void {
  const state = ctx.messages.message(data.sessionID, data.assistantMessageID);
  if (!state) return;
  const id = `prt_${data.assistantMessageID}_${kind}_${data.ordinal}`;
  const prev = state.parts.get(id);
  // Tanpa token sama sekali (mis. reasoning tersembunyi) -> tidak ada part.
  if (data.text === "" && !state.emitted.has(id)) return;
  state.emitted.add(id);
  const start = prev?.time?.start ?? ctx.opts.now();
  ctx.messages.put(state, data.assistantMessageID, {
    id,
    type: kind,
    text: data.text,
    time: { start, end: ctx.opts.now() },
    ...ctx.subagents.parentField(
      data.sessionID,
      data.parentToolID ?? (prev?.parentToolID as string),
    ),
  });
}
