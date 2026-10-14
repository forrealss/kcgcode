/**
 * Listener `AgentEvent` satu client Claude Code (`event.subscribe`). Handler
 * yang melempar tidak menghentikan pengiriman ke handler lain.
 */
import type { AgentEvent } from "../types";

export class ClaudeEventHub {
  private readonly listeners = new Set<(ev: AgentEvent) => void>();

  /** Kirim event ke seluruh listener (urut pendaftaran). */
  readonly emit = (ev: AgentEvent): void => {
    for (const cb of this.listeners) {
      try {
        cb(ev);
      } catch (e) {
        console.warn("[kcg-code] handler event claude-code gagal:", e);
      }
    }
  };

  /** Daftarkan listener; kembalian = fungsi berhenti berlangganan. */
  subscribe(cb: (ev: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
