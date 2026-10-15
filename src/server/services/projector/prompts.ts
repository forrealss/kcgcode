/**
 * Interactive_Prompt dari agent: `permission.asked` / `form.created` ->
 * prompt tersimpan, beserta definisi form dan Session agent pemilik tiap
 * prompt (untuk menyusun & mengarahkan jawaban).
 */
import type { AgentEventData, AgentForm } from "../../agents/types";
import { promptFromForm, promptFromPermission } from "../session-events";
import type { AgentProjectorOptions } from "./types";

export class PromptRegistry {
  /** Form yang menunggu jawaban (id form -> definisi) untuk menyusun jawaban. */
  private readonly forms = new Map<string, AgentForm>();
  /**
   * Session agent pemilik tiap prompt (id request/form -> sessionID agent).
   * Prompt sub-agent dimiliki child session, bukan Session akar — reply
   * harus ditujukan ke sana.
   */
  private readonly owners = new Map<string, string>();

  constructor(private readonly opts: AgentProjectorOptions) {}

  /** Definisi form untuk prompt question (hilang setelah restart server). */
  form(formId: string): AgentForm | undefined {
    return this.forms.get(formId);
  }

  /** Session agent yang memunculkan prompt (undefined = tidak diketahui). */
  owner(promptId: string): string | undefined {
    return this.owners.get(promptId);
  }

  /** Lupakan prompt yang sudah dijawab/dibatalkan. */
  forget(promptId: string): void {
    this.forms.delete(promptId);
    this.owners.delete(promptId);
  }

  /** Permission sudah dijawab: pemiliknya tidak perlu diingat lagi. */
  permissionReplied(requestID: string): void {
    this.owners.delete(requestID);
  }

  permissionAsked(data: AgentEventData<"permission.asked">): void {
    const sessionId = this.opts.resolve(data.sessionID);
    if (!sessionId) return;
    // Menunggu keputusan user bukan sunyi: reset timer idle turn.
    this.opts.turns.keepAlive(sessionId);
    this.owners.set(data.id, data.sessionID);
    const prompt = promptFromPermission(data, sessionId, this.opts.now());
    if (this.opts.insertPrompt(prompt)) this.opts.onPrompt?.(prompt);
  }

  formCreated(data: AgentEventData<"form.created">): void {
    const form = data.form;
    const sessionId = this.opts.resolve(form.sessionID);
    if (!sessionId) return;
    this.opts.turns.keepAlive(sessionId);
    this.forms.set(form.id, form);
    this.owners.set(form.id, form.sessionID);
    const prompt = promptFromForm(form, sessionId, this.opts.now());
    if (this.opts.insertPrompt(prompt)) this.opts.onPrompt?.(prompt);
  }
}
