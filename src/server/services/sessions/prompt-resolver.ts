/**
 * Menjawab Interactive_Prompt (kartu permission / question) lewat
 * `permission.reply` / `form.reply|cancel`, termasuk fan-out ke kartu kembar
 * dalam grup yang sama.
 */
import type { SessionStore } from "../../../db";
import type { AgentType, InteractivePrompt, PromptResponse } from "../../../types";
import { AGENT_REQUEST_GONE, type AgentClient } from "../../agents/types";
import type { SimpleResult } from "../../result";
import type { AgentEventProjector } from "../agent-projector";
import { formAnswerFromLabels, labelsFromResponse, permissionGroupKey } from "../session-events";

export interface PromptResolverOptions {
  store: SessionStore;
  projector: AgentEventProjector;
  clientFor: (agentType: AgentType, projectId: string) => AgentClient | undefined;
  now: () => number;
  onPromptResolved?: (sessionId: string, promptId: string) => void;
}

type PermissionDecision = "once" | "always" | "reject";

/** Jawaban kartu permission -> keputusan agent (null = respons tidak valid). */
function permissionDecision(response: PromptResponse): PermissionDecision | null {
  switch (response) {
    case "approve":
      return "once";
    case "always":
      return "always";
    case "deny":
    case "cancel":
      return "reject";
    default:
      return null;
  }
}

export function createPromptResolver(opts: PromptResolverOptions) {
  const { store, projector, now, onPromptResolved } = opts;

  /** Tandai prompt selesai di DB dan lupakan state proyeksinya. */
  function markResolved(promptId: string): void {
    store.updatePromptStatus(promptId, "resolved", now());
    projector.forgetPrompt(promptId);
  }

  /**
   * Jawab satu prompt. Permission: `always` = "Always allow" — agent
   * mengingat pola yang disetujui sehingga request identik berikutnya tidak
   * lagi menampilkan kartu; `deny`/`cancel` = tolak. Question (form): label
   * terpilih per pertanyaan diubah ke jawaban form; `cancel` = batalkan form.
   * Opsi yang tidak ada di daftar tersimpan TIDAK ditolak di sini — agent
   * yang tahu daftar sebenarnya (baris DB lama / skema berubah).
   */
  async function answer(
    client: AgentClient,
    owner: string | null,
    id: string,
    kind: InteractivePrompt["kind"],
    response: PromptResponse,
  ): Promise<SimpleResult> {
    if (!owner) return { ok: false, error: "SESSION_NOT_ACTIVE" };
    if (kind === "permission") {
      const decision = permissionDecision(response);
      if (!decision) return { ok: false, error: "INVALID_PROMPT_RESPONSE" };
      return client.permission.reply({ sessionID: owner, requestID: id, decision });
    }
    if (response === "cancel") return client.form.cancel({ sessionID: owner, formID: id });
    const labels = labelsFromResponse(response);
    if (!labels) return { ok: false, error: "INVALID_PROMPT_RESPONSE" };
    return client.form.reply({
      sessionID: owner,
      formID: id,
      answer: formAnswerFromLabels(projector.form(id), labels),
    });
  }

  return async function resolvePrompt(
    sessionId: string,
    promptId: string,
    response: PromptResponse,
  ): Promise<SimpleResult> {
    const p = store.getPrompt(promptId);
    if (!p.ok) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.sessionId !== sessionId) return { ok: false, error: "PROMPT_NOT_FOUND" };
    if (p.data.status !== "pending") return { ok: false, error: "PROMPT_ALREADY_RESOLVED" };

    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    const client = opts.clientFor(cur.data.agentType, cur.data.projectId);
    if (!client) return { ok: false, error: "SESSION_NOT_ACTIVE" };
    const rootSession = cur.data.ocSessionId;

    // Kumpulkan request pending yang identik (grup kartu yang sama di UI):
    // jawaban satu kartu diteruskan ke seluruh anggota grup. Tanpa ini,
    // kartu kembar yang tertinggal di agent membuat turn berikutnya
    // menggantung menunggu keputusan yang sudah diambil user.
    const targets = store
      .listPendingPrompts(sessionId)
      .filter((q) => q.id !== promptId && permissionGroupKey(q) === permissionGroupKey(p.data));

    /** Session agent pemilik prompt (child sub-agent atau Session akar). */
    const reply = (id: string, kind: InteractivePrompt["kind"]) =>
      answer(client, projector.promptOwner(id) ?? rootSession, id, kind, response);

    const res = await reply(promptId, p.data.kind);
    if (!res.ok) {
      if (res.error === AGENT_REQUEST_GONE) {
        // Agent tidak lagi menunggu request ini: sudah dijawab dari klien
        // lain, dibatalkan karena turn di-interrupt, atau agent di-restart.
        // Tanpa penutupan di sini, baris DB tetap `pending`: kartu tidak bisa
        // dijawab MAUPUN di-Skip dan composer tetap tersembunyi — session
        // terkunci. Tutup prompt (dan kembarannya) secara lokal supaya UI pulih.
        markResolved(promptId);
        for (const twin of targets) {
          markResolved(twin.id);
          onPromptResolved?.(sessionId, twin.id);
        }
        return { ok: false, error: "PROMPT_EXPIRED" };
      }
      return { ok: false, error: res.error };
    }
    markResolved(promptId);
    // Jawaban question cukup lewat reply API — tidak di-echo ke riwayat chat
    // agar transcript bersih (agent tetap menerima jawabannya).
    // Fan-out best-effort ke kartu kembar; kegagalan satu request tidak
    // menggagalkan jawaban utama yang sudah diterima agent.
    for (const twin of targets) {
      const twinRes = await reply(twin.id, twin.kind);
      if (twinRes.ok) {
        markResolved(twin.id);
        onPromptResolved?.(sessionId, twin.id);
      }
    }
    return { ok: true };
  };
}
