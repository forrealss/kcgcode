/**
 * Urutan shutdown server. Urutannya disengaja: timer & layanan latar
 * dihentikan dulu, tunnel publik ditutup sebelum server berhenti, status
 * Session disimpan, baru server & store ditutup.
 */

import type { Server } from "bun";
import type { SessionStore } from "../../db";
import type { DevServerManager } from "../services/preview/dev-servers";
import type { PreviewServer } from "../services/preview/preview-server";
import type { Screenshotter } from "../services/preview/screenshot";
import type { UpdateChecker } from "../services/update-check";
import type { Access } from "./access";
import type { SessionCore } from "./session-core";
import type { WsData } from "./ws-connections";

export interface ShutdownDeps {
  sweepTimer: ReturnType<typeof setInterval>;
  core: SessionCore;
  access: Access;
  updates: UpdateChecker;
  server: Server<WsData>;
  store: SessionStore;
  devServers: DevServerManager;
  preview: PreviewServer;
  screenshotter: Screenshotter;
}

export function createShutdown(deps: ShutdownDeps): () => Promise<void> {
  const { sweepTimer, core, access, updates, server, store, devServers, preview, screenshotter } =
    deps;
  return async function close(): Promise<void> {
    clearInterval(sweepTimer);
    core.notifications.close();
    updates.close();
    // Hentikan frpc lebih dulu agar URL publik tidak menunjuk server mati.
    await Promise.all([access.tunnel.shutdown(), access.lhr.shutdown()]);
    // Dev server Preview dimatikan per process group agar tidak ada yatim.
    await Promise.all([devServers.shutdown(), preview.stop(), screenshotter.close()]);
    // Hentikan instalasi skill yang berjalan agar proses CLI tidak yatim.
    await core.skillInstalls.cancelAll();
    // shutdown() menyimpan status running (budget 5s) lalu menghentikan server headless.
    await core.sessionManager.shutdown();
    // Bun (Windows): setelah server menutup sebuah WebSocket (mis. 4401 saat
    // logout), promise `stop()` tak pernah resolve walau listener sudah
    // tertutup — batasi waktu tunggu agar shutdown tidak menggantung.
    await Promise.race([server.stop(true), Bun.sleep(2000)]);
    store.close();
  };
}
