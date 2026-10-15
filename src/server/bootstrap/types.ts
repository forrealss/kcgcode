/**
 * Kontrak publik composition root (`app.ts`): opsi injeksi `createKcgServer`
 * dan handle server yang dikembalikan. Diekspor ulang dari `app.ts` agar
 * importer tetap memakai path lama.
 */

import type { HTMLBundle, Server } from "bun";
import type { AppConfig } from "../../config";
import type { SessionStore } from "../../db";
import type { AgentBackend } from "../agents/types";
import type { ApiRouteContext } from "../routes/types";
import type { AuthService } from "../services/auth";
import type { NotificationService } from "../services/notifications";
import type { ProjectManager } from "../services/project-manager";
import type { SessionManager } from "../services/session-manager";
import type { SkillsRegistry } from "../services/skills-registry";
import type { TunnelManager } from "../services/tunnel";
import type { LhrManager } from "../services/tunnel-lhr";
import type { UpdateChecker } from "../services/update-check";
import type { WebSocketGateway } from "../services/websocket-gateway";
import type { WsData } from "./ws-connections";

/** Dependensi yang hanya diketahui composition root, untuk factory tunnel. */
export interface TunnelFactoryDeps {
  store: SessionStore;
  auth: AuthService;
  port: number;
  hostname: string;
}

export interface KcgServerOptions {
  config?: AppConfig;
  store?: SessionStore;
  /** Injeksi backend agent opencode v2 (untuk pengujian). */
  opencode?: AgentBackend;
  /** Injeksi backend Claude Code (Agent SDK) untuk pengujian. */
  claude?: AgentBackend;
  /** Injeksi Skills_Registry (skills.sh + CLI `skills`) untuk pengujian. */
  skillsRegistry?: SkillsRegistry;
  /** Injeksi Auth_Service (mis. hash cepat untuk test). */
  auth?: AuthService;
  /**
   * Factory Tunnel_Manager (test menyuntik API/spawn palsu). Menerima
   * dependensi yang hanya diketahui composition root.
   */
  tunnel?: (deps: TunnelFactoryDeps) => TunnelManager;
  /** Factory tunnel localhost.run (test menyuntik spawn palsu). */
  lhr?: (deps: TunnelFactoryDeps) => LhrManager;
  /** Direktori lampiran gambar upload (default: `~/.kcgcode/data/uploads`). */
  uploadsRoot?: string;
  hostname?: string;
  port?: number;
  /** Fetch untuk layanan Web Push (test menyuntik palsu). */
  pushFetch?: typeof fetch;
  /** Pengecek versi baru di npm (default: aktif hanya di mode `cli`). */
  updates?: UpdateChecker;
  /** Shell SPA untuk rute halaman terdaftar (`spaPaths`; default: 404). */
  spa?: Response | HTMLBundle;
  /**
   * Rute halaman yang menyajikan shell SPA — didaftarkan eksplisit di entry
   * (`src/index.ts`) persis seperti daftar rute SPA kcgcode; path lain 404.
   */
  spaPaths?: string[];
  /**
   * Asset frontend hasil build (`dist/web`) per path URL — dipakai binary
   * global sebagai pengganti bundling HTML saat runtime.
   */
  assets?: Record<string, () => Response>;
}

export interface KcgServer {
  server: Server<WsData>;
  store: SessionStore;
  projectManager: ProjectManager;
  sessionManager: SessionManager;
  gateway: WebSocketGateway;
  /** Job instalasi skill (diekspos untuk pengujian). */
  skillInstalls: ApiRouteContext["skillInstalls"];
  /** Kunci aplikasi (diekspos untuk pengujian & CLI). */
  auth: AuthService;
  /** Tunnel publik (diekspos untuk dashboard terminal & pengujian). */
  tunnel: TunnelManager;
  /** Tunnel localhost.run (diekspos untuk dashboard terminal). */
  lhr: LhrManager;
  /** Notifikasi agent (WS + Web Push) — diekspos untuk pengujian. */
  notifications: NotificationService;
  /** Versi baru di npm (dashboard terminal & `/api/meta`). */
  updates: UpdateChecker;
  /** Provider tunnel terpilih: "kcg" | "lhr". */
  tunnelProvider: () => "kcg" | "lhr";
  /** Pola rute `/api/*` yang terdaftar (untuk test cakupan penjaga). */
  apiRoutePatterns: string[];
  /** Shutdown: simpan status running (budget 5s) -> stop server -> tutup store. */
  close(): Promise<void>;
}
