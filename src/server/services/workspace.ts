/**
 * Workspace (Sandbox_Root) yang bisa diubah dari Settings tanpa restart.
 *
 * Sandbox_Root adalah BATAS KEAMANAN: semua Project, Folder_Browser, dan
 * agent hanya boleh bekerja di dalamnya (termasuk saat diakses lewat
 * tunnel). Karena itu mengganti root:
 * - wajib konfirmasi PIN/password bila app dikunci (`AuthService`),
 * - menolak folder yang terlalu luas (root filesystem, home, direktori
 *   sistem) dan folder milik KCG Code sendiri (data / config),
 * - menolak bila masih ada Project terdaftar di luar root baru — Project
 *   tidak boleh diam-diam menjadi "di luar sandbox",
 * - ditulis ke `config.json` (sumber kebenaran yang sama dengan CLI
 *   `kcgcode init`), lalu berlaku seketika di proses yang berjalan.
 */
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Project } from "../../types";
import type { Result } from "../result";

export const WORKSPACE_PATH_MAX = 1024;

export interface WorkspaceInfo {
  /** Root aktif (path absolut hasil realpath). */
  root: string;
  /** Root ditampilkan dengan `~` untuk home (lebih mudah dibaca). */
  display: string;
  /** Jumlah Project terdaftar di dalam root. */
  projectCount: number;
  configPath: string;
}

export interface WorkspaceCandidate {
  /** Path absolut hasil realpath (folder dibuat bila `create`). */
  root: string;
  /** Folder belum ada & akan dibuat. */
  willCreate: boolean;
}

/** Tampilkan path dengan `~` bila berada di home pengguna. */
export function displayPath(p: string, home: string = homedir()): string {
  // `undefined` eksplisit dari pemanggil -> tetap pakai home asli.
  home ??= homedir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return `~${p.slice(home.length)}`;
  return p;
}

/** Perluas `~` / `~/x` ke home. Path relatif ditolak (ambigu: relatif ke cwd server). */
export function expandUserPath(input: string, home: string = homedir()): string | null {
  const raw = input.trim();
  if (raw === "~") return home;
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(home, raw.slice(2));
  if (!path.isAbsolute(raw)) return null;
  return path.normalize(raw);
}

/**
 * Direktori yang terlalu luas / sensitif untuk dijadikan workspace: memberi
 * agent akses ke seluruh sistem atau seluruh home pengguna.
 */
export function isTooBroad(realRoot: string, home: string = homedir()): boolean {
  const p = path.resolve(realRoot);
  // Root filesystem (`/`, `C:\`).
  if (path.dirname(p) === p) return true;
  const homeReal = safeRealpath(home) ?? home;
  if (p === homeReal || p === home) return true;
  // Leluhur home (mis. `/home`, `/Users`) juga mencakup home pengguna lain.
  if (homeReal.startsWith(p + path.sep)) return true;
  if (process.platform !== "win32") {
    const system = [
      "/bin",
      "/boot",
      "/dev",
      "/etc",
      "/lib",
      "/lib64",
      "/opt",
      "/proc",
      "/root",
      "/run",
      "/sbin",
      "/srv",
      "/sys",
      "/tmp",
      "/usr",
      "/var",
      "/System",
      "/Library",
      "/Applications",
      "/private",
      "/Volumes",
      "/mnt",
      "/media",
    ];
    // Persis direktori sistem (sub-folder di /mnt/data atau /opt/work boleh).
    if (system.includes(p)) return true;
  }
  return false;
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function isWithin(root: string, p: string): boolean {
  return p === root || p.startsWith(root + path.sep);
}

/**
 * Validasi kandidat root baru. `protectedDirs` = folder milik KCG Code
 * (data, uploads, config) yang tidak boleh berada di dalam workspace —
 * agent bisa membaca DB (hash sandi, token tunnel) bila itu terjadi.
 */
export function validateWorkspaceRoot(
  input: unknown,
  opts: { create: boolean; protectedDirs: string[]; home?: string },
): Result<WorkspaceCandidate> {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, error: "WORKSPACE_PATH_REQUIRED" };
  }
  if (input.length > WORKSPACE_PATH_MAX || input.includes("\0")) {
    return { ok: false, error: "WORKSPACE_PATH_INVALID" };
  }
  const home = opts.home ?? homedir();
  const expanded = expandUserPath(input, home);
  if (expanded === null) return { ok: false, error: "WORKSPACE_PATH_NOT_ABSOLUTE" };

  let willCreate = false;
  if (!existsSync(expanded)) {
    if (!opts.create) return { ok: false, error: "WORKSPACE_NOT_FOUND" };
    // Hanya satu tingkat terakhir yang boleh dibuat: induknya harus ada
    // (menghindari salah ketik membuat pohon folder baru di tempat acak).
    const parent = path.dirname(expanded);
    if (!existsSync(parent)) return { ok: false, error: "WORKSPACE_PARENT_NOT_FOUND" };
    willCreate = true;
  }

  // Resolusi symlink: keputusan keamanan berdasarkan lokasi NYATA.
  const real = willCreate
    ? path.join(
        safeRealpath(path.dirname(expanded)) ?? path.dirname(expanded),
        path.basename(expanded),
      )
    : safeRealpath(expanded);
  if (real === null) return { ok: false, error: "WORKSPACE_NOT_FOUND" };

  if (!willCreate) {
    try {
      if (!statSync(real).isDirectory()) return { ok: false, error: "WORKSPACE_NOT_DIRECTORY" };
    } catch {
      return { ok: false, error: "WORKSPACE_NOT_FOUND" };
    }
  }

  if (isTooBroad(real, home)) return { ok: false, error: "WORKSPACE_TOO_BROAD" };

  for (const dir of opts.protectedDirs) {
    const d = safeRealpath(dir) ?? path.resolve(dir);
    // Workspace tidak boleh MEMUAT folder data KCG Code, dan sebaliknya
    // tidak boleh berada di dalamnya.
    if (isWithin(real, d) || isWithin(d, real)) {
      return { ok: false, error: "WORKSPACE_CONTAINS_APP_DATA" };
    }
  }

  const writableTarget = willCreate ? path.dirname(real) : real;
  try {
    accessSync(writableTarget, constants.R_OK | constants.W_OK);
  } catch {
    return { ok: false, error: "WORKSPACE_NOT_WRITABLE" };
  }

  return { ok: true, data: { root: real, willCreate } };
}

/** Project yang akan berada DI LUAR root baru (menghalangi perubahan). */
export function projectsOutside(root: string, projects: Project[]): Project[] {
  return projects.filter((p) => !isWithin(root, safeRealpath(p.path) ?? path.resolve(p.path)));
}

/**
 * Tulis `sandboxRoot` ke config.json. Kunci lain di file dipertahankan;
 * penulisan atomik (file sementara + rename) agar config tidak pernah
 * setengah tertulis bila proses mati di tengah jalan.
 */
export function writeSandboxRoot(configPath: string, root: string): Result<null> {
  let obj: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    }
  } catch {
    return { ok: false, error: "WORKSPACE_CONFIG_UNREADABLE" };
  }
  obj.sandboxRoot = root;
  try {
    mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
    renameSync(tmp, configPath);
  } catch {
    return { ok: false, error: "WORKSPACE_CONFIG_WRITE_FAILED" };
  }
  return { ok: true, data: null };
}
