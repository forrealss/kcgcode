/**
 * Perakitan tabel rute `/api/*`: konteks bersama (`ApiRouteContext`) disuntik
 * ke tiap tabel rute per fitur (`routes/*.routes.ts`), lalu seluruhnya
 * dibungkus `guardRoutes` agar dijaga kunci aplikasi (kecuali
 * status/login/avatar).
 */

import path from "node:path";
import type { AppConfig } from "../../config";
import type { SessionStore } from "../../db";
import { resolveEffectiveDbPath, resolveFrpcConfigPath, resolveTurnDiffsDir } from "../../paths";
import { authRoutes } from "../routes/auth.routes";
import { guardRoutes } from "../routes/auth-guard";
import { changesRoutes } from "../routes/changes.routes";
import { metaRoutes } from "../routes/meta.routes";
import { passkeyRoutes } from "../routes/passkeys.routes";
import { previewRoutes } from "../routes/preview.routes";
import { projectsRoutes } from "../routes/projects.routes";
import { pushRoutes } from "../routes/push.routes";
import { sessionsRoutes } from "../routes/sessions.routes";
import { skillsRoutes } from "../routes/skills.routes";
import { tunnelRoutes } from "../routes/tunnel.routes";
import type { ApiRouteContext, ProtectedPaths } from "../routes/types";
import { updateRoutes } from "../routes/update.routes";
import { uploadsRoutes } from "../routes/uploads.routes";
import { workspaceRoutes } from "../routes/workspace.routes";
import type { DevServerManager } from "../services/preview/dev-servers";
import type { PreviewServer } from "../services/preview/preview-server";
import type { Screenshotter } from "../services/preview/screenshot";
import type { PreviewSnapshots } from "../services/preview/snapshots";
import type { SelfUpdater } from "../services/self-update";
import type { UpdateChecker } from "../services/update-check";
import type { Access } from "./access";
import type { SessionCore } from "./session-core";

export interface ApiRoutesDeps {
  config: AppConfig;
  store: SessionStore;
  uploadsRoot: string;
  core: SessionCore;
  access: Access;
  updates: UpdateChecker;
  selfUpdate: SelfUpdater;
  devServers: DevServerManager;
  preview: PreviewServer;
  screenshotter: Screenshotter;
  snapshots: PreviewSnapshots;
}

/**
 * Data (DB, uploads, turn-diffs, frpc.toml) & config KCG Code — dirakit
 * sekali dari path yang sama untuk validasi workspace dan viewer file.
 */
export function protectedPaths(configPath: string, uploadsRoot: string): ProtectedPaths {
  const dbPath = resolveEffectiveDbPath();
  const turnDiffsDir = resolveTurnDiffsDir(uploadsRoot);
  return {
    dirs: [path.dirname(dbPath), uploadsRoot, turnDiffsDir, path.dirname(configPath)],
    files: [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      uploadsRoot,
      turnDiffsDir,
      resolveFrpcConfigPath(),
      configPath,
    ],
  };
}

export function createApiRoutes(deps: ApiRoutesDeps) {
  const { config, store, uploadsRoot, core, access } = deps;
  const { auth, passkeys, tunnel, lhr } = access;

  // Konteks bersama untuk semua tabel rute API.
  const ctx: ApiRouteContext = {
    auth,
    passkeys,
    notifications: core.notifications,
    updates: deps.updates,
    selfUpdate: deps.selfUpdate,
    configPath: config.configPath,
    protectedPaths: protectedPaths(config.configPath, uploadsRoot),
    projectManager: core.projectManager,
    sessionManager: core.sessionManager,
    attachments: core.attachments,
    skillsRegistry: core.skillsRegistry,
    skillInstalls: core.skillInstalls,
    tunnel,
    lhr,
    tunnelProvider: () => store.getTunnelSettings(Date.now()).provider,
    setTunnelProvider: (provider) => store.setTunnelProvider(provider, Date.now()),
    notifyDataChanged: () => core.gateway.notifyDataChanged(),
    devServers: deps.devServers,
    preview: deps.preview,
    screenshotter: deps.screenshotter,
    snapshots: deps.snapshots,
    turnDiffs: core.turnDiffs,
  };

  return guardRoutes(auth, {
    ...authRoutes(ctx),
    ...passkeyRoutes(ctx),
    ...metaRoutes(ctx),
    ...updateRoutes(ctx),
    ...projectsRoutes(ctx),
    ...sessionsRoutes(ctx),
    ...uploadsRoutes(ctx),
    ...skillsRoutes(ctx),
    ...tunnelRoutes(ctx),
    ...previewRoutes(ctx),
    ...changesRoutes(ctx),
    ...pushRoutes(ctx),
    ...workspaceRoutes(ctx),
  });
}
