/**
 * Kirim input bebas ke agent: validasi, echo pesan user, judul sementara,
 * pembukaan turn streaming, lalu penerapan pilihan Session + `session.prompt`
 * yang diserialisasi per Session (antrean tugas) agar turn tidak tumpang
 * tindih. Hasil turn tiba lewat event agent, bukan dari fungsi ini.
 */
import { randomUUID } from "node:crypto";
import type { SessionMessage } from "../../../types";
import type { SimpleResult } from "../../result";
import { deriveSessionTitle, friendlySendError, isPlaceholderTitle } from "../session-events";
import { buildPromptInput, type ResolvedAttachment, validateFreeText } from "./prompt-input";
import type { SessionRuntime } from "./runtime";

export function createMessageSender(rt: SessionRuntime) {
  const { store, attachments, now, turns, onMessage, extraInstructions } = rt;

  /** Serialisasi kirim pesan per Session agar turn tidak tumpang tindih. */
  const inflight = new Map<string, Promise<void>>();

  function enqueue(sessionId: string, task: () => Promise<void>): void {
    const prev = inflight.get(sessionId) ?? Promise.resolve();
    const next = prev.then(task).finally(() => {
      if (inflight.get(sessionId) === next) inflight.delete(sessionId);
    });
    inflight.set(sessionId, next);
  }

  return async function sendFreeTextInput(
    sessionId: string,
    text: string,
    files: string[] = [],
    images: string[] = [],
  ): Promise<SimpleResult> {
    const hasImages = images.length > 0;
    const invalid = validateFreeText(text, hasImages);
    if (invalid) return { ok: false, error: invalid };
    const cur = store.getSession(sessionId);
    if (!cur.ok) return { ok: false, error: "SESSION_NOT_FOUND" };
    if (cur.data.status !== "running") return { ok: false, error: "SESSION_NOT_ACTIVE" };
    const session = cur.data;
    const ocSessionId = session.ocSessionId;
    if (!ocSessionId) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    // Pastikan client agent siap SEBELUM menyimpan echo user.
    const client = rt.clientFor(session.agentType, session.projectId);
    if (!client) return { ok: false, error: "SESSION_NOT_ACTIVE" };

    // Gambar upload dipetakan ke info + path absolut. Kegagalan resolve
    // (id tidak dikenal / sudah dihapus) menolak pengiriman tanpa echo.
    const resolved: ResolvedAttachment[] = [];
    for (const id of images) {
      const info = attachments?.info(sessionId, id);
      if (!info?.ok) return { ok: false, error: "ATTACHMENT_NOT_FOUND" };
      resolved.push(info.data);
    }
    const input = buildPromptInput(session.cwd, text, files, resolved);

    // Echo pesan user (disimpan + dikirim ke Client) sebelum menunggu balasan.
    const userMessage: SessionMessage = {
      id: `usr_${randomUUID()}`,
      sessionId,
      role: "user",
      parts: input.userParts,
      createdAt: now(),
    };
    if (!store.insertMessage(userMessage).ok) return { ok: false, error: "MESSAGE_WRITE_FAILED" };
    onMessage?.(userMessage);

    // Judul SEMENTARA sampai agent mengirim judul hasil generate
    // (`session.renamed`, biasanya beberapa detik). Bila masih placeholder /
    // null, turunkan dari teks prompt pertama. Gambar saja -> "Image".
    if (isPlaceholderTitle(session.title)) {
      const candidate = deriveSessionTitle(text) ?? (hasImages ? "Image" : null);
      if (candidate) rt.updateTitle(sessionId, candidate);
    }

    // Turn sebelumnya yang belum idle ditutup dulu agar parts-nya tidak
    // tercampur ke turn baru dan tidak hilang.
    turns.finish(sessionId);

    // Mulai turn streaming: parts hasil proyeksi event di-forward. Jaring
    // pengaman bila akhir eksekusi tidak pernah datang (mis. agent mati di
    // tengah turn): batas IDLE, di-reset tiap tanda hidup — parts yang sudah
    // terkumpul tetap disimpan saat dipicu.
    rt.beginTurn(sessionId);

    // Custom instruction Project dibaca saat kirim (bukan saat Session dibuat)
    // agar perubahan instruksi langsung berlaku di prompt berikutnya.
    const projectRes = store.getProjectById(session.projectId);
    const system =
      [projectRes.ok ? projectRes.data.instructions : null, extraInstructions?.(session)]
        .map((t) => t?.trim())
        .filter(Boolean)
        .join("\n\n") || null;

    enqueue(sessionId, async () => {
      try {
        // Terapkan pilihan Session (model, agent, instruksi Project) lalu
        // kirim prompt; hasil turn tiba lewat event dan ditutup oleh
        // `session.execution.*` Session akar.
        const steps = [
          () => client.session.switchModel(ocSessionId, session.model, session.effort ?? null),
          () => client.session.switchAgent(ocSessionId, session.agent),
          () => client.session.instructions(ocSessionId, system),
          // Hanya agent yang punya konsep permission mode.
          ...(client.capabilities.permissionModes.length > 0
            ? [() => client.session.setPermissionMode(ocSessionId, session.permissionMode ?? null)]
            : []),
          () =>
            client.session.prompt({
              sessionID: ocSessionId,
              text: input.promptText,
              files: input.promptFiles,
            }),
        ];
        for (const step of steps) {
          const res = await step();
          if (!res.ok) {
            turns.fail(sessionId, friendlySendError(res.error ?? "AGENT_PROMPT_FAILED"));
            return;
          }
        }
      } catch (e) {
        turns.fail(sessionId, friendlySendError(`SEND_FAILED: ${(e as Error).message}`));
      }
    });

    return { ok: true };
  };
}
