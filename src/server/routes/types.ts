/**
 * Tipe bersama tabel rute API (pola `routes/types.ts` kcgcode).
 *
 * Composition root (`app.ts`) merakit service lalu menyuntikkannya ke tiap
 * tabel rute via `ApiRouteContext`; handler tidak lagi menutup dependency
 * secara langsung seperti saat semuanya menumpuk di `app.ts`.
 */

import type { TunnelProvider } from "../db/tunnel";
import type { AttachmentManager } from "../services/attachments";
import type { DevServerManager } from "../services/preview/dev-servers";
import type { PreviewServer } from "../services/preview/preview-server";
import type { Screenshotter } from "../services/preview/screenshot";
import type { PreviewSnapshots } from "../services/preview/snapshots";
import type { ProjectManager } from "../services/project-manager";
import type { SessionManager } from "../services/session-manager";
import type { SkillInstallJobs } from "../services/skill-install-jobs";
import type { SkillsRegistry } from "../services/skills-registry";
import type { TunnelManager } from "../services/tunnel";
import type { LhrManager } from "../services/tunnel-lhr";
import type { TurnDiffs } from "../services/turn-diffs";

export interface ApiRouteContext {
  projectManager: ProjectManager;
  sessionManager: SessionManager;
  attachments: AttachmentManager;
  skillsRegistry: SkillsRegistry;
  skillInstalls: SkillInstallJobs;
  tunnel: TunnelManager;
  /** Tunnel localhost.run (alternatif tanpa akun). */
  lhr: LhrManager;
  /** Penyedia remote access terpilih. */
  tunnelProvider: () => TunnelProvider;
  setTunnelProvider: (provider: TunnelProvider) => void;
  /**
   * Beri tahu semua klien bahwa daftar Project/Session berubah (buat/hapus)
   * agar sidebar & daftar di perangkat lain ikut terbarui.
   */
  notifyDataChanged: () => void;
  /** Dev server per Project (fitur Preview). */
  devServers: DevServerManager;
  /** Listener proxy Preview (port + penerbit tiket). */
  preview: PreviewServer;
  /** Chrome headless untuk snapshot preview. */
  screenshotter: Screenshotter;
  /** Snapshot otomatis setelah turn (terbaru per Session). */
  snapshots: PreviewSnapshots;
  /** File yang diubah agent per turn. */
  turnDiffs: TurnDiffs;
}
