/**
 * Rekonsiliasi saat startup, shutdown dalam budget waktu, dan penanganan
 * agent yang hilang tak terduga (Session Project-nya ditandai `crashed`).
 */
import type { SessionRuntime } from "./runtime";

export function createStartupShutdown(rt: SessionRuntime) {
  const { store, now, clients, turns, agentSessions, skills } = rt;

  /** Requirement 2.4: seluruh Session `running` tanpa agent -> `crashed`. */
  function reconcileOnStartup(): void {
    for (const s of store.listSessions()) {
      if (s.status === "running") rt.updateStatus(s.id, "crashed", now());
    }
  }

  /** Balapan dengan timer budget; timer selalu dibersihkan setelah selesai. */
  async function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: unknown;
    const timeout: Promise<T> = new Promise((_resolve, reject) => {
      timer = rt.setTimeoutFn(() => reject(new Error("shutdown budget exceeded")), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer !== undefined) rt.clearTimeoutFn(timer);
    }
  }

  /**
   * Requirement 2.3: simpan status terakhir Session `running` dalam budget
   * waktu, lalu lepas seluruh backend agent.
   */
  async function shutdown(): Promise<void> {
    // Refresh skill tertunda tidak relevan lagi: client dilepas, skill
    // terbaca saat client dibuat berikutnya.
    skills.clear();
    const running = store.listSessions().filter((s) => s.status === "running");
    const results = running.map((s) => store.insertStatusHistory(s.id, "running", now()));
    await raceWithTimeout(Promise.resolve(results), rt.shutdownBudgetMs);
    await clients.shutdown();
  }

  /** Saat agent hilang tak terduga, tandai Session project tsb `crashed`. */
  function watchAgentLoss(): void {
    clients.onLost((agentType, projectId) => {
      const crashedAt = now();
      for (const s of store.listSessions()) {
        if (s.projectId === projectId && s.agentType === agentType && s.status === "running") {
          // Agent mati di tengah turn: selamatkan parts yang sudah ter-stream.
          turns.finish(s.id, "crash");
          rt.updateStatus(s.id, "crashed", crashedAt);
          agentSessions.unmap(s.id);
        }
      }
    });
  }

  return { reconcileOnStartup, shutdown, watchAgentLoss };
}
