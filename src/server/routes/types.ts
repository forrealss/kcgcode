/**
 * Tipe bersama tabel rute API (pola `routes/types.ts` kcgcode).
 *
 * Composition root (`app.ts`) merakit service lalu menyuntikkannya ke tiap
 * tabel rute via `ApiRouteContext`; handler tidak lagi menutup dependency
 * secara langsung seperti saat semuanya menumpuk di `app.ts`.
 */

import type { TunnelProvider } from "../db/tunnel";
import type { AttachmentManager } from "../services/attachments";
import type { ProjectManager } from "../services/project-manager";
import type { SessionManager } from "../services/session-manager";
import type { SkillInstallJobs } from "../services/skill-install-jobs";
import type { SkillsRegistry } from "../services/skills-registry";
import type { TunnelManager } from "../services/tunnel";
import type { LhrManager } from "../services/tunnel-lhr";

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
}
