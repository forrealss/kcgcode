/**
 * Header halaman detail Project: nama besar, path (salin saat hover), aksi.
 * Desktop: menu "..." + "New session" di kanan judul. Layar sempit: toolbar
 * "Details" (panel samping) + menu "..." di bawah judul.
 */
import {
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

/** Path Project yang bisa diklik untuk disalin — ikon muncul saat hover. */
export function CopyablePath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      toast.success("Path copied.");
    } catch {
      // Clipboard API butuh konteks aman (HTTPS / localhost).
      toast.error("Couldn't copy. Select the path and copy it manually.");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={path}
      aria-label={copied ? "Path copied" : `Copy path ${path}`}
      className="group/path -mx-1 flex max-w-full min-w-0 items-center gap-1.5 rounded px-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="truncate">{path}</span>
      {copied ? (
        <CheckIcon className="size-3 shrink-0 text-emerald-500" aria-hidden />
      ) : (
        <CopyIcon
          className="size-3 shrink-0 opacity-0 transition-opacity group-hover/path:opacity-100 group-focus-visible/path:opacity-100"
          aria-hidden
        />
      )}
    </button>
  );
}

/**
 * Aksi sekunder Project (Reload, Delete) di satu menu "..." — Delete jarang
 * dipakai & berbahaya, jadi tidak perlu tombol sendiri yang selalu terlihat.
 * Delete tetap lewat dialog konfirmasi.
 */
export function ProjectMenu({
  loading,
  onReload,
  onDelete,
  className,
}: {
  loading: boolean;
  onReload: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {/* Tombol bundar `.circular` Adwaita: latar terisi, tanpa border. */}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="More project actions"
              className={cn("rounded-full", className)}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={onReload} disabled={loading}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
          Reload sessions
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon />
          Delete project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectHeader({
  project,
  wide,
  loading,
  onReload,
  onDelete,
  onNewSession,
  onShowDetails,
}: {
  project: Project;
  /** Layar `lg`+: panel detail sudah inline, aksi di kanan judul. */
  wide: boolean;
  /** Daftar Session sedang dimuat (Reload dinonaktifkan). */
  loading: boolean;
  onReload: () => void;
  onDelete: () => void;
  onNewSession: () => void;
  /** Buka panel samping (Sheet) — hanya layar sempit. */
  onShowDetails: () => void;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-4 lg:pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            {project.name}
          </h1>
          <CopyablePath path={project.path} />
        </div>

        {/* Desktop: aksi di kanan judul (panel detail sudah inline). */}
        {wide && (
          <div className="flex shrink-0 items-center gap-2">
            <ProjectMenu loading={loading} onReload={onReload} onDelete={onDelete} />
            <Button type="button" onClick={onNewSession} className="rounded-full px-4">
              <PlusIcon data-icon="inline-start" />
              New session
            </Button>
          </div>
        )}
      </div>

      {/* Layar sempit: toolbar aksi sekunder di bawah judul. Aksi utama
          (New session) jadi tombol melayang kanan-bawah — area jempol. */}
      {!wide && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onShowDetails}
            aria-label="Project details: instructions, MCP servers, skills"
            className="h-10 rounded-full px-3.5"
          >
            <PanelRightIcon data-icon="inline-start" />
            Details
          </Button>
          <ProjectMenu
            className="size-10"
            loading={loading}
            onReload={onReload}
            onDelete={onDelete}
          />
        </div>
      )}
    </header>
  );
}
