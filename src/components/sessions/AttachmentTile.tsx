/**
 * Tampilan satu lampiran non-gambar: ikon berwarna sesuai jenis file + nama
 * + keterangan singkat (ekstensi · ukuran). Dipakai composer (lampiran
 * pending & animasi plate) dan bubble pesan user (tautan unduh).
 */
import {
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { attachmentKind, fileExtension, formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";

const CODE_EXT = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "astro",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "scala",
  "go",
  "rs",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "swift",
  "m",
  "dart",
  "lua",
  "pl",
  "r",
  "jl",
  "ex",
  "exs",
  "erl",
  "hs",
  "clj",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "xml",
  "graphql",
  "gql",
  "proto",
  "tf",
  "hcl",
  "nix",
  "svg",
]);
const SHEET_EXT = new Set(["csv", "tsv", "xls", "xlsx", "ods", "numbers"]);
const ARCHIVE_EXT = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst"]);

interface Glyph {
  Icon: LucideIcon;
  /** Kelas warna kotak ikon (latar tipis + warna ikon). */
  tone: string;
}

export function fileGlyph(mime: string, filename: string): Glyph {
  const ext = fileExtension(filename);
  const kind = attachmentKind(mime, filename);
  if (kind === "image")
    return { Icon: ImageIcon, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-400" };
  if (kind === "pdf")
    return { Icon: FileTextIcon, tone: "bg-red-500/15 text-red-600 dark:text-red-400" };
  if (SHEET_EXT.has(ext)) {
    return {
      Icon: FileSpreadsheetIcon,
      tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    };
  }
  if (CODE_EXT.has(ext)) {
    return { Icon: FileCodeIcon, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400" };
  }
  if (ARCHIVE_EXT.has(ext)) {
    return { Icon: FileArchiveIcon, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
  }
  if (mime.startsWith("audio/")) {
    return { Icon: FileAudioIcon, tone: "bg-pink-500/15 text-pink-600 dark:text-pink-400" };
  }
  if (mime.startsWith("video/")) {
    return { Icon: FileVideoIcon, tone: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" };
  }
  if (kind === "text") return { Icon: FileTextIcon, tone: "bg-muted text-muted-foreground" };
  return { Icon: FileIcon, tone: "bg-muted text-muted-foreground" };
}

/** "PDF · 1.2 MB" — ekstensi (atau "File") + ukuran bila diketahui. */
export function fileMeta(filename: string, size?: number): string {
  const ext = fileExtension(filename);
  const label = ext ? ext.toUpperCase() : "File";
  return size !== undefined && size > 0 ? `${label} · ${formatBytes(size)}` : label;
}

export function FileTile({
  filename,
  mime,
  size,
  className,
}: {
  filename: string;
  mime: string;
  size?: number;
  className?: string;
}) {
  const { Icon, tone } = fileGlyph(mime, filename);
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-2.5 text-left",
        className,
      )}
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", tone)}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] leading-5 font-medium">{filename}</span>
        <span className="truncate text-[11.5px] leading-4 text-muted-foreground">
          {fileMeta(filename, size)}
        </span>
      </span>
    </span>
  );
}
