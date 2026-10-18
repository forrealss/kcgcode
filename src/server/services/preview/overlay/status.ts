/** Status Session/agent untuk subjudul header: nada titik + teks. */
import { canSend, state } from "./state";

export type StatusTone = "" | "ok" | "busy" | "bad";

export function sessionStatus(): { tone: StatusTone; label: string } {
  const base = ((): { tone: StatusTone; label: string } => {
    if (!state.session) return { tone: "", label: location.host };
    if (state.attention) return { tone: "bad", label: "Waiting for your answer" };
    if (state.session.status === "crashed") return { tone: "bad", label: "Session crashed" };
    if (!canSend()) return { tone: "", label: "Session stopped" };
    if (state.turnActive) return { tone: "busy", label: "Agent is working…" };
    return { tone: "ok", label: "Agent is idle" };
  })();
  const phase = state.server?.phase;
  return phase && phase !== "running"
    ? { tone: base.tone, label: `${base.label} · dev server ${phase}` }
    : base;
}
