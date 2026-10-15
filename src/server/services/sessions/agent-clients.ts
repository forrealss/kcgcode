/**
 * Client agent per (tipe CLI_Agent, Project): membuat client lewat
 * `AgentBackend`, menjaga satu langganan event per client, dan meneruskan
 * kabar backend hilang (sekali per kejadian).
 */
import type { SessionStore } from "../../../db";
import type { AgentType } from "../../../types";
import type { AgentBackend, AgentClient, AgentEvent } from "../../agents/types";
import type { Result } from "../../result";
import { SUPPORTED_AGENT_TYPES } from "./types";

export interface AgentClientsOptions {
  store: SessionStore;
  backends: Partial<Record<AgentType, AgentBackend>>;
  /** Penerima seluruh event agent dari semua client. */
  onEvent: (ev: AgentEvent) => void;
}

/** Kunci subscription/exit per backend + Project (keduanya bisa hidup). */
function backendKey(agentType: AgentType, projectId: string): string {
  return `${agentType}:${projectId}`;
}

export class AgentClients {
  private readonly store: SessionStore;
  private readonly backends: Partial<Record<AgentType, AgentBackend>>;
  private readonly onEvent: (ev: AgentEvent) => void;
  /** Langganan event per backend+Project (lihat `backendKey`) beserta client-nya. */
  private readonly subscriptions = new Map<
    string,
    { client: AgentClient; unsubscribe: () => void }
  >();
  /** Backend+Project yang sudah diproses saat agent-nya hilang (hindari duplikasi). */
  private readonly exitNotified = new Set<string>();

  constructor(opts: AgentClientsOptions) {
    this.store = opts.store;
    this.backends = opts.backends;
    this.onEvent = opts.onEvent;
  }

  /** Backend milik tipe CLI_Agent (undefined = tipe tidak aktif). */
  backendFor(agentType: AgentType): AgentBackend | undefined {
    return this.backends[agentType];
  }

  /** Tipe didukung DAN backend-nya diinjeksi. */
  isEnabled(agentType: AgentType): boolean {
    return SUPPORTED_AGENT_TYPES.includes(agentType) && this.backendFor(agentType) !== undefined;
  }

  /** Client agent Project yang sudah siap (tanpa membuat baru). */
  get(agentType: AgentType, projectId: string): AgentClient | undefined {
    return this.backendFor(agentType)?.get(projectId);
  }

  /**
   * Pastikan client agent Project siap dan event-nya disubscribe. Client
   * baru (backend membuat ulang client, mis. direktori Project berubah)
   * menggantikan langganan lama.
   */
  async ensure(
    projectId: string,
    projectPath: string,
    agentType: AgentType = "opencode",
  ): Promise<Result<AgentClient>> {
    const backend = this.backendFor(agentType);
    if (!backend) return { ok: false, error: "UNSUPPORTED_AGENT_TYPE" };
    const res = await backend.ensure(projectId, projectPath);
    if (!res.ok) return res;
    const client = res.data;
    const key = backendKey(agentType, projectId);
    const sub = this.subscriptions.get(key);
    if (sub?.client !== client) {
      sub?.unsubscribe();
      const unsubscribe = client.event.subscribe((ev) => this.onEvent(ev));
      this.subscriptions.set(key, { client, unsubscribe });
    }
    // Client siap — izinkan event kehilangan berikutnya diproses.
    this.exitNotified.delete(key);
    return { ok: true, data: client };
  }

  /** Client agent Project (dibuat bila perlu) untuk operasi baca daftar. */
  async forProject(projectId: string, agentType: AgentType): Promise<Result<AgentClient>> {
    const project = this.store.getProjectById(projectId);
    if (!project.ok) return { ok: false, error: "PROJECT_NOT_FOUND" };
    return this.ensure(project.data.id, project.data.path, agentType);
  }

  /** Lepas client seluruh tipe agent milik Project beserta langganannya. */
  async release(projectId: string): Promise<void> {
    for (const agentType of SUPPORTED_AGENT_TYPES) {
      await this.backendFor(agentType)?.release(projectId);
      // Langganan event ikut dilepas — client-nya sudah tidak dipakai.
      const key = backendKey(agentType, projectId);
      this.subscriptions.get(key)?.unsubscribe();
      this.subscriptions.delete(key);
      this.exitNotified.delete(key);
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(SUPPORTED_AGENT_TYPES.map((t) => this.backendFor(t)?.shutdown()));
  }

  /**
   * Daftarkan handler agent hilang tak terduga. Dipanggil sekali per
   * kejadian sampai client Project itu di-`ensure` lagi.
   */
  onLost(handler: (agentType: AgentType, projectId: string) => void): void {
    for (const agentType of SUPPORTED_AGENT_TYPES) {
      this.backendFor(agentType)?.onLost((projectId) => {
        const key = backendKey(agentType, projectId);
        if (this.exitNotified.has(key)) return;
        this.exitNotified.add(key);
        handler(agentType, projectId);
      });
    }
  }
}
