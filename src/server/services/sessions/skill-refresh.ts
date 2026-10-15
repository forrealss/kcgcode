/**
 * Refresh skill setelah skill dipasang. Agent yang tidak bisa memuat ulang
 * skill di tengah turn (opencode: dispose instance) ditunda selama Project
 * punya turn aktif, lalu dijalankan OTOMATIS begitu seluruh turn selesai.
 */
import type { SessionStore } from "../../../db";
import type { AgentType } from "../../../types";
import type { AgentClient } from "../../agents/types";
import type { Result } from "../../result";

/** Default jeda refresh skill tertunda setelah turn terakhir selesai. */
export const SKILL_REFRESH_DELAY_MS = 1500;

export interface SkillRefresherOptions {
  store: SessionStore;
  /** Client agent Project yang sudah siap (tanpa membuat baru). */
  clientFor: (agentType: AgentType, projectId: string) => AgentClient | undefined;
  /** Session dengan turn streaming aktif. */
  hasTurn: (sessionId: string) => boolean;
  /** Jeda setelah turn terakhir selesai sebelum dispose (biarkan event penutup tuntas). */
  delayMs?: number;
  setTimeoutFn: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  /** Refresh tertunda baru saja dijalankan otomatis untuk Project ini. */
  onRefreshed?: (projectId: string) => void;
}

export class SkillRefresher {
  /**
   * Project yang refresh skill-nya tertunda karena ada turn aktif saat skill
   * dipasang. Dijalankan otomatis begitu seluruh turn di Project selesai.
   */
  private readonly pending = new Set<string>();
  /** Timer refresh tertunda per Project (dibatalkan bila turn baru dimulai). */
  private readonly timers = new Map<string, unknown>();
  private readonly delayMs: number;

  constructor(private readonly opts: SkillRefresherOptions) {
    this.delayMs = opts.delayMs ?? SKILL_REFRESH_DELAY_MS;
  }

  hasPending(projectId: string): boolean {
    return this.pending.has(projectId);
  }

  /** Status turn Session berubah — jadwalkan / tunda refresh Project-nya. */
  onTurnChange(sessionId: string, active: boolean): void {
    const session = this.opts.store.getSession(sessionId);
    if (!session.ok || !this.pending.has(session.data.projectId)) return;
    const projectId = session.data.projectId;
    // Turn baru dimulai sebelum timer jalan -> tunda lagi.
    if (active) this.cancelScheduled(projectId);
    else this.schedule(projectId);
  }

  /**
   * Muat ulang skill client Project. `refreshed: false` = ditunda (ada turn
   * aktif, atau reload gagal dan dicoba lagi setelah turn berikutnya).
   */
  async refresh(
    projectId: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<{ refreshed: boolean }>> {
    const project = this.opts.store.getProjectById(projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    const client = this.opts.clientFor(agentType, projectId);
    // Client belum dibuat -> skill terbaca saat client dibuat nanti.
    if (!client) {
      if (agentType === "opencode") this.pending.delete(projectId);
      return { ok: true, data: { refreshed: true } };
    }
    // Agent yang bisa memuat ulang skill di tengah turn (Claude Code
    // `reloadSkills`) tidak perlu menunggu Project idle. Gagal pun skill
    // tetap terbaca oleh proses `claude` berikutnya.
    if (!client.capabilities.skillReload) {
      const res = await client.location.reload();
      if (!res.ok) console.warn(`[kcg-code] reload skill Project ${projectId} gagal:`, res.error);
      return { ok: true, data: { refreshed: true } };
    }
    if (this.projectBusy(projectId)) {
      this.pending.add(projectId);
      return { ok: true, data: { refreshed: false } };
    }
    this.cancelScheduled(projectId);
    const res = await client.location.reload();
    if (!res.ok) {
      console.warn(`[kcg-code] refresh skill Project ${projectId} gagal:`, res.error);
      // Coba lagi otomatis setelah turn berikutnya selesai.
      this.pending.add(projectId);
      return { ok: true, data: { refreshed: false } };
    }
    this.pending.delete(projectId);
    return { ok: true, data: { refreshed: true } };
  }

  /**
   * Batalkan seluruh refresh tertunda (shutdown: client dilepas, skill
   * terbaca saat client dibuat berikutnya).
   */
  clear(): void {
    for (const projectId of [...this.timers.keys()]) this.cancelScheduled(projectId);
    this.pending.clear();
  }

  private projectBusy(projectId: string): boolean {
    return this.opts.store
      .listSessions()
      .some((s) => s.projectId === projectId && this.opts.hasTurn(s.id));
  }

  private cancelScheduled(projectId: string): void {
    const t = this.timers.get(projectId);
    if (t === undefined) return;
    this.opts.clearTimeoutFn(t);
    this.timers.delete(projectId);
  }

  /** Jadwalkan refresh tertunda bila Project sudah tidak punya turn aktif. */
  private schedule(projectId: string): void {
    if (this.projectBusy(projectId)) return;
    this.cancelScheduled(projectId);
    const handle = this.opts.setTimeoutFn(() => {
      this.timers.delete(projectId);
      void this.runPending(projectId);
    }, this.delayMs);
    this.timers.set(projectId, handle);
  }

  private async runPending(projectId: string): Promise<void> {
    if (!this.pending.has(projectId)) return;
    // Turn baru sempat dimulai -> tunggu turn berikutnya selesai.
    if (this.projectBusy(projectId)) return;
    const client = this.opts.clientFor("opencode", projectId);
    if (!client) {
      // Client belum/tidak lagi dipakai -> skill terbaca saat dibuat lagi.
      this.pending.delete(projectId);
      this.opts.onRefreshed?.(projectId);
      return;
    }
    const res = await client.location.reload();
    if (!res.ok) {
      // Tetap tertunda; dicoba lagi setelah turn berikutnya selesai.
      console.warn(`[kcg-code] refresh skill tertunda Project ${projectId} gagal:`, res.error);
      return;
    }
    this.pending.delete(projectId);
    this.opts.onRefreshed?.(projectId);
  }
}
