/**
 * Perakitan tabel rute `/api/*`: konteks bersama (`ApiRouteContext`) disuntik
 * ke tiap tabel rute per fitur (`routes/*.routes.ts`), lalu seluruhnya
 * dibungkus `guardRoutes` agar dijaga kunci aplikasi (kecuali
 * status/login/avatar).
 */

import path from "node:path";
import type { AppConfig } from "../../config";
import type { SessionStore } from "../../db";
import { resolveEffectiveDbPath } from "../../paths";
import { authRoutes } from "../routes/auth.routes";
import { guardRoutes } from "../routes/auth-guard";
import { metaRoutes } from "../routes/meta.routes";
import { passkeyRoutes } from "../routes/passkeys.routes";
import { projectsRoutes } from "../routes/projects.routes";
import { pushRoutes } from "../routes/push.routes";
import { sessionsRoutes } from "../routes/sessions.routes";
import { skillsRoutes } from "../routes/skills.routes";
import { tunnelRoutes } from "../routes/tunnel.routes";
import type { ApiRouteContext } from "../routes/types";
import { uploadsRoutes } from "../routes/uploads.routes";
import { workspaceRoutes } from "../routes/workspace.routes";
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
}

export function createApiRoutes(deps: ApiRoutesDeps) {
  const { config, store, uploadsRoot, core, access, updates } = deps;
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
  };

  return guardRoutes(auth, {
    ...authRoutes(auth),
    ...passkeyRoutes(auth, passkeys),
    ...metaRoutes(updates),
    ...projectsRoutes(routeCtx),
    ...sessionsRoutes(routeCtx),
    ...uploadsRoutes(routeCtx),
    ...skillsRoutes(routeCtx),
    ...tunnelRoutes(routeCtx),
    ...pushRoutes(core.notifications),
    ...workspaceRoutes(routeCtx, {
      auth,
      configPath: config.configPath,
      // Data (DB, uploads, frpc.toml) & config KCG Code tak boleh berada di
      // dalam workspace — agent bisa membaca hash sandi / token tunnel.
      protectedDirs: [
        path.dirname(resolveEffectiveDbPath()),
        uploadsRoot,
        path.dirname(config.configPath),
      ],
    }),
  });
}
