/**
 * Tipe bersama tabel rute API (pola `routes/types.ts` kcgcode).
 *
 * Composition root (`app.ts`) merakit service lalu menyuntikkannya ke tiap
 * tabel rute via `ApiRouteContext`; handler tidak lagi menutup dependency
 * secara langsung seperti saat semuanya menumpuk di `app.ts`.
 */

import type { TunnelProvider } from "../db/tunnel";
import type { AttachmentManager } from "../services/attachments";
import type { AuthService } from "../services/auth";
import type { PasskeyService } from "../services/auth-passkeys";
import type { NotificationService } from "../services/notifications";
import type { DevServerManager } from "../services/preview/dev-servers";
import type { PreviewServer } from "../services/preview/preview-server";
import type { Screenshotter } from "../services/preview/screenshot";
import type { PreviewSnapshots } from "../services/preview/snapshots";
import type { ProjectManager } from "../services/project-manager";
import type { SelfUpdater } from "../services/self-update";
import type { SessionManager } from "../services/session-manager";
import type { SkillInstallJobs } from "../services/skill-install-jobs";
import type { SkillsRegistry } from "../services/skills-registry";
import type { TunnelManager } from "../services/tunnel";
import type { LhrManager } from "../services/tunnel-lhr";
import type { TurnDiffs } from "../services/turn-diffs";
import type { UpdateChecker } from "../services/update-check";

/**
 * Data & config milik KCG Code (DB, uploads, turn-diffs, frpc.toml, config)
 * — agent bisa membaca hash sandi / token tunnel bila terekspos.
 */
export interface ProtectedPaths {
  /** Folder yang tak boleh tumpang tindih dengan workspace (Sandbox_Root). */
  dirs: string[];
  /**
   * File/folder spesifik yang tak boleh dibuka viewer file walau berada di
   * dalam Project (bukan foldernya — workspace default `~/.kcgcode/sandbox`
   * berada di folder yang sama).
   */
  files: string[];
}

export interface ApiRouteContext {
  /** Kunci aplikasi (lock screen, sesi, profil). */
  auth: AuthService;
  passkeys: PasskeyService;
  notifications: NotificationService;
  /** Cek versi baru di npm (Settings -> About). */
  updates?: UpdateChecker;
  /** Pasang versi baru dari app (Settings -> About). */
  selfUpdate: SelfUpdater;
  /** File config aktif (ditulis saat workspace diganti). */
  configPath: string;
  protectedPaths: ProtectedPaths;
  /** Home pengguna (`~`) — diinjeksi agar test tidak menyentuh home asli. */
  home?: string;
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
