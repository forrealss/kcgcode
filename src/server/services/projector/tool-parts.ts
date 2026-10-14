/**
 * Part tool: tool call `C` -> part `prt_C` (`type: "tool"`) dengan
 * `state.status` pending -> running -> completed|error. Tool `task`
 * opencode diantrekan agar Session anaknya bisa ditautkan.
 */
import type { AgentEventData } from "../../agents/types";
import { toolContentText } from "./tool-output";
import type { ProjectorContext } from "./types";

function toolPart(
  ctx: ProjectorContext,
  agentSessionID: string,
  messageID: string,
  toolId: string,
  state: Record<string, unknown>,
  parentToolID?: string,
): void {
  const msg = ctx.messages.message(agentSessionID, messageID);
  if (!msg) return;
  const id = `prt_${toolId}`;
  const prev = msg.parts.get(id);
  const prevState = (prev?.state ?? {}) as Record<string, unknown>;
  const time = (prevState.time ?? {}) as { start?: number };
  ctx.messages.ownTool(toolId, agentSessionID, messageID);
  ctx.messages.put(msg, messageID, {
    id,
    type: "tool",
    tool: ctx.messages.toolNames.get(toolId) ?? (prev?.tool as string | undefined) ?? "tool",
    callID: toolId,
    ...ctx.subagents.parentField(agentSessionID, parentToolID ?? (prev?.parentToolID as string)),
    state: {
      ...prevState,
      ...state,
      time: { start: time.start ?? ctx.opts.now(), ...(state.time as object) },
    },
  });
}

export function toolInputStarted(
  ctx: ProjectorContext,
  data: AgentEventData<"session.tool.input.started">,
): void {
  ctx.messages.toolNames.set(data.id, data.name);
  toolPart(
    ctx,
    data.sessionID,
    data.assistantMessageID,
    data.id,
    { status: "pending", input: {} },
    data.parentToolID,
  );
}

export function toolCalled(
  ctx: ProjectorContext,
  data: AgentEventData<"session.tool.called">,
): void {
  if (data.name) ctx.messages.toolNames.set(data.id, data.name);
  toolPart(
    ctx,
    data.sessionID,
    data.assistantMessageID,
    data.id,
    { status: "running", input: data.input },
    data.parentToolID,
  );
  // Tool `task` opencode akan membuat Session anak — tautkan saat dibuat.
  if (ctx.messages.toolNames.get(data.id) === "task") {
    ctx.subagents.queueTask(data.sessionID, data.id);
  }
}

export function toolSucceeded(
  ctx: ProjectorContext,
  data: AgentEventData<"session.tool.success">,
): void {
  toolPart(ctx, data.sessionID, data.assistantMessageID, data.id, {
    status: "completed",
    output: toolContentText(data.content),
    ...(data.metadata ? { metadata: data.metadata } : {}),
    time: { end: ctx.opts.now() },
  });
}

export function toolFailed(
  ctx: ProjectorContext,
  data: AgentEventData<"session.tool.failed">,
): void {
  const output = toolContentText(data.content);
  toolPart(ctx, data.sessionID, data.assistantMessageID, data.id, {
    status: "error",
    error: data.error.message,
    ...(output ? { output } : {}),
    ...(data.metadata ? { metadata: data.metadata } : {}),
    time: { end: ctx.opts.now() },
  });
}
