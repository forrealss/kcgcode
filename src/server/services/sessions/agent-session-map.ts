/**
 * Pemetaan id Session agent -> id Session lokal.
 *
 * Selain Session yang dibuat lewat `session.create`, map ini juga memuat
 * child session yang dibuat agent sendiri saat model memanggil sub-agent.
 * Child session punya `sessionID` sendiri di event, sehingga tanpa pemetaan
 * ini event-nya (termasuk `permission.asked`) akan terbuang.
 */
export class AgentSessionMap {
  private readonly toLocal = new Map<string, string>();
  /** Kebalikan `toLocal`: id Session lokal -> seluruh id Session agent miliknya. */
  private readonly owned = new Map<string, Set<string>>();

  /** Session lokal pemilik id Session agent (induk maupun child). */
  resolve(agentSessionId: string): string | undefined {
    return this.toLocal.get(agentSessionId);
  }

  /** Catat pemetaan id Session agent -> Session lokal (juga untuk cleanup). */
  map(agentSessionId: string, sessionId: string): void {
    this.toLocal.set(agentSessionId, sessionId);
    let owned = this.owned.get(sessionId);
    if (!owned) {
      owned = new Set<string>();
      this.owned.set(sessionId, owned);
    }
    owned.add(agentSessionId);
  }

  /** Lepas seluruh id Session agent (induk + child) milik satu Session lokal. */
  unmap(sessionId: string): void {
    const owned = this.owned.get(sessionId);
    if (!owned) return;
    for (const id of owned) this.toLocal.delete(id);
    this.owned.delete(sessionId);
  }
}
