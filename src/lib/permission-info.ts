/**
 * Penjelasan izin tool untuk manusia — logika murni (tanpa DOM, diuji).
 *
 * Server menyimpan judul permission sebagai satu string ringkas hasil
 * `describePermission`: `"<permission> — `pola1` — `pola2`"` (mis.
 * ``external_directory — `/home/u/.config/opencode/*` ``). String itu
 * akurat tapi tidak ramah: nama permission internal opencode + pola glob
 * mentah. Helper ini memecahnya menjadi:
 * - `label`  : kalimat singkat apa yang diminta agent ("Access a folder
 *              outside the project").
 * - `targets`: pola yang terdampak, tanpa backtick.
 * - `risk`   : seberapa hati-hati pengguna perlu (menentukan warna kartu).
 *
 * Daftar permission mengikuti skema `PermissionConfig` opencode. Permission
 * yang tidak dikenal (versi opencode lebih baru) tetap tampil dengan nama
 * aslinya — tidak pernah disembunyikan.
 */

export type PermissionRisk = "low" | "medium" | "high";

export interface PermissionInfo {
  /** Nama permission opencode apa adanya (mis. `external_directory`). */
  permission: string | null;
  /** Kalimat ramah tentang apa yang diminta. */
  label: string;
  /** Pola/path/perintah yang terdampak (tanpa backtick). */
  targets: string[];
  risk: PermissionRisk;
}

interface PermissionMeta {
  label: string;
  risk: PermissionRisk;
}

/**
 * Permission opencode -> label & risiko.
 * - high   : bisa mengubah sistem / keluar dari batas project.
 * - medium : mengubah file project / menjalankan agent lain / akses jaringan.
 * - low    : hanya membaca.
 */
const PERMISSIONS: Record<string, PermissionMeta> = {
  bash: { label: "Run a shell command", risk: "high" },
  external_directory: { label: "Access a folder outside the project", risk: "high" },
  doom_loop: { label: "Keep going after repeating the same step", risk: "medium" },
  edit: { label: "Edit files", risk: "medium" },
  task: { label: "Start a sub-agent", risk: "medium" },
  webfetch: { label: "Fetch a web page", risk: "medium" },
  websearch: { label: "Search the web", risk: "medium" },
  skill: { label: "Use a skill", risk: "medium" },
  read: { label: "Read files", risk: "low" },
  list: { label: "List folder contents", risk: "low" },
  glob: { label: "Search for files", risk: "low" },
  grep: { label: "Search inside files", risk: "low" },
  lsp: { label: "Use the language server", risk: "low" },
  todowrite: { label: "Update the task list", risk: "low" },
  question: { label: "Ask you a question", risk: "low" },
};

/** Judul fallback server saat event tidak membawa nama permission. */
const FALLBACK_TITLES = new Set(["Izin tool", "Tool permission"]);

/** Ubah `snake_case` menjadi kalimat ("external_directory" -> "External directory"). */
function humanize(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Pecah judul permission server menjadi info yang bisa dibaca manusia.
 * Format masukan: `"<permission>"`, `"<permission> — `a` — `b`"`, atau
 * judul fallback / null.
 */
export function parsePermissionTitle(title: string | null): PermissionInfo {
  const raw = (title ?? "").trim();
  if (raw === "" || FALLBACK_TITLES.has(raw)) {
    return { permission: null, label: "Use a tool", targets: [], risk: "medium" };
  }

  const [head = "", ...rest] = raw.split(" — ");
  const permission = head.trim();
  // Pola dibungkus backtick oleh server; buang backtick-nya. Bagian tanpa
  // backtick tetap diterima (format lama / pihak lain).
  const targets = rest
    .map((part) =>
      part
        .trim()
        .replace(/^`(.*)`$/s, "$1")
        .trim(),
    )
    .filter((t) => t !== "");

  const meta = PERMISSIONS[permission.toLowerCase()];
  return {
    permission,
    label: meta?.label ?? humanize(permission),
    targets,
    // Permission tak dikenal: anggap sedang — jangan meremehkan risikonya.
    risk: meta?.risk ?? "medium",
  };
}
