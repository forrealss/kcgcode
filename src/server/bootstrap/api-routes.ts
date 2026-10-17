/**
 * Perakitan tabel rute `/api/*`: konteks bersama (`ApiRouteContext`) disuntik
 * ke tiap tabel rute per fitur (`routes/*.routes.ts`), lalu seluruhnya
 * dibungkus `guardRoutes` agar dijaga kunci aplikasi (kecuali
 * status/login/avatar).
 */

import path from "node:path";
import type { AppConfig } from "../../config";
import type { SessionStore } from "../../db";
import { resolveEffectiveDbPath, resolveFrpcConfigPath } from "../../paths";
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
import type { ApiRouteContext } from "../routes/types";
import { uploadsRoutes } from "../routes/uploads.routes";
import { workspaceRoutes } from "../routes/workspace.routes";
import type { DevServerManager } from "../services/preview/dev-servers";
import type { PreviewServer } from "../services/preview/preview-server";
import type { Screenshotter } from "../services/preview/screenshot";
import type { PreviewSnapshots } from "../services/preview/snapshots";
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
  devServers: DevServerManager;
  preview: PreviewServer;
  screenshotter: Screenshotter;
  snapshots: PreviewSnapshots;
}

export function createApiRoutes(deps: ApiRoutesDeps) {
  const {
    config,
    store,
    uploadsRoot,
    core,
    access,
    updates,
    devServers,
    preview,
    screenshotter,
    snapshots,
  } = deps;
  const { auth, passkeys, tunnel, lhr } = access;

  // Konteks bersama untuk tabel rute API.
  const routeCtx: ApiRouteContext = {
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
    devServers,
    preview,
    screenshotter,
    snapshots,
    turnDiffs: core.turnDiffs,
  };

  // Data (DB, uploads, frpc.toml) & config KCG Code tak boleh berada di
  // dalam workspace — agent bisa membaca hash sandi / token tunnel.
  const dbPath = resolveEffectiveDbPath();
  const protectedDirs = [
    path.dirname(resolveEffectiveDbPath()),
    uploadsRoot,
    path.dirname(config.configPath),
  ];

  return guardRoutes(auth, {
    ...authRoutes(auth),
    ...passkeyRoutes(auth, passkeys),
    ...metaRoutes(updates),
    ...projectsRoutes(routeCtx),
    ...sessionsRoutes(routeCtx),
    ...uploadsRoutes(routeCtx),
    ...skillsRoutes(routeCtx),
    ...tunnelRoutes(routeCtx),
    ...previewRoutes(routeCtx),
    // Viewer file: path kcgcode yang spesifik (bukan foldernya — workspace
    // default `~/.kcgcode/sandbox` berada di folder yang sama).
    ...changesRoutes(routeCtx, {
      protectedDirs: [
        dbPath,
        `${dbPath}-wal`,
        `${dbPath}-shm`,
        uploadsRoot,
        path.join(path.dirname(uploadsRoot), "turn-diffs"),
        resolveFrpcConfigPath(),
        config.configPath,
      ],
    }),
    ...pushRoutes(core.notifications),
    ...workspaceRoutes(routeCtx, {
      auth,
      configPath: config.configPath,
      protectedDirs,
    }),
  });
}
