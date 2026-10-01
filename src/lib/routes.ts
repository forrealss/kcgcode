/**
 * Route URL KCG Code — logika murni (tanpa DOM / History API).
 *
 * Dipisah dari `hooks/useRouter.ts` agar dapat diuji dengan `bun test`
 * (pola yang sama dengan `useTheme.ts`). Server (`src/server/app.ts`)
 * menyajikan shell SPA hanya untuk rute halaman yang terdaftar di
 * `src/index.ts` (lihat `spaPaths`), sehingga React tinggal memetakan
 * `location.pathname` -> view lewat `parseRoute()`.
 */

/** Route hasil parsing `location.pathname`. */
export type AppRoute =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "session"; projectId: string; sessionId: string }
  | { name: "skills" }
  | { name: "settings"; section: SettingsSection }
  | { name: "not-found" };

/** Sub-halaman Settings (`/settings/:section`). */
export const SETTINGS_SECTIONS = ["profile", "security", "remote", "devices", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** URL daftar Project. */
export function projectsPath(): string {
  return "/";
}

/** URL daftar Session milik sebuah Project. */
export function projectPath(projectId: string): string {
  return `/projects/${projectId}`;
}

/** URL Session view milik sebuah Project. */
export function sessionPath(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/sessions/${sessionId}`;
}

/**
 * URL halaman Skills. `projectId` (opsional) jadi query `?project=` agar
 * Project tersebut otomatis terpilih saat halaman dibuka.
 */
export function skillsPath(projectId?: string | null): string {
  return projectId ? `/skills?project=${encodeURIComponent(projectId)}` : "/skills";
}

/** URL halaman Settings; tanpa `section` = `/settings` (dibuka sebagai Profile). */
export function settingsPath(section?: SettingsSection): string {
  return section ? `/settings/${section}` : "/settings";
}

/** Ambil id Project dari query string halaman Skills (`?project=`). */
export function parseSkillsProject(search: string): string | null {
  const id = new URLSearchParams(search).get("project");
  return id !== null && id.length > 0 ? id : null;
}

/**
 * Pemetaan `pathname` -> `AppRoute`. Segment id dianggap opaque — id
 * Project/Session berupa UUID sehingga aman tanpa decoding. Trailing slash
 * diabaikan (`/projects/x/` sama dengan `/projects/x`).
 */
export function parseRoute(pathname: string): AppRoute {
  const segments = pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return { name: "projects" };
  if (segments[0] === "skills" && segments.length === 1) return { name: "skills" };
  if (segments[0] === "settings") {
    if (segments.length === 1) return { name: "settings", section: "profile" };
    const section = segments[1];
    if (segments.length === 2 && section !== undefined && isSettingsSection(section)) {
      return { name: "settings", section };
    }
    return { name: "not-found" };
  }
  if (segments[0] !== "projects") return { name: "not-found" };

  const projectId = segments[1];
  if (projectId === undefined || projectId.length === 0) return { name: "not-found" };

  if (segments.length === 2) return { name: "project", projectId };

  if (segments[2] === "sessions" && segments.length === 4) {
    const sessionId = segments[3];
    if (sessionId !== undefined && sessionId.length > 0) {
      return { name: "session", projectId, sessionId };
    }
  }

  return { name: "not-found" };
}
