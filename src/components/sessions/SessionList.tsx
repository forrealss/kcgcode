/**
 * Daftar & pembuatan Session milik sebuah Project (Requirement 1.1, 1.3, 1.5).
 *
 * Halaman detail Project — sengaja minimal: tipografi & ruang kosong yang
 * bekerja, bukan kartu/tile.
 * - Header: nama Project besar, path (salin saat hover), satu baris ringkasan
 *   ("3 sessions · 1 running"). Aksi: "New session" + menu "..." Reload/Delete
 *   (`ProjectMenu`; hapus tetap lewat dialog konfirmasi). Desktop: di
 *   kanan judul. Layar sempit: "New session" jadi tombol melayang kanan-bawah
 *   (area jempol); toolbar di bawah judul berisi "Details" (panel samping)
 *   dan grup Reload/Delete.
 * - Panel samping (`ProjectSidePanel`, gaya Claude Projects): custom
 *   instruction, MCP server, dan skill. Layar `lg`+ = kolom kanan sticky;
 *   lebih sempit = Sheet dari kanan lewat tombol di header.
 *   Tanpa tombol back — navigasi lewat sidebar.
 * - Daftar Session: baris polos dipisah hairline, status lewat titik warna.
 *   Urutan dari `sortSessions` (running -> crashed -> stopped, terbaru dulu).
 * - `GET /api/sessions` di-filter per `projectId` (Requirement 1.5).
 *
 * File ini hanya menyusun area dari bagian yang sudah dipisah:
 * - State & aksi daftar: `hooks/useSessionList.ts`.
 * - Form pembuatan Session: `NewSessionDialog.tsx`.
 * - Satu baris Session: `SessionRow.tsx`; dialog konfirmasi hapus:
 *   `ConfirmSessionDeleteDialog.tsx` & `ConfirmDeleteProjectDialog.tsx`.
 */
import {
  CheckIcon,
  CopyIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProjectSidePanel } from "@/components/projects/ProjectSidePanel";
import { ConfirmDeleteProjectDialog } from "@/components/sessions/ConfirmDeleteProjectDialog";
import { ConfirmSessionDeleteDialog } from "@/components/sessions/ConfirmSessionDeleteDialog";
import { NewSessionDialog } from "@/components/sessions/NewSessionDialog";
import { SessionListSkeleton, SessionRow } from "@/components/sessions/SessionRow";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useSessionList } from "@/hooks/useSessionList";
import { notifyDataChanged } from "@/lib/data-events";
import { describeSessionSummary } from "@/lib/session-summary";
import { cn } from "@/lib/utils";
import type { Project, Session } from "@/types";

/** Breakpoint `lg` Tailwind — di atasnya panel samping tampil inline. */
const WIDE_QUERY = "(min-width: 1024px)";

export interface SessionListProps {
  project: Project;
  onOpenSession: (session: Session) => void;
  /** Dipanggil setelah Project dihapus, untuk kembali ke daftar Project. */
  onDeleted?: () => void;
}

/** Path Project yang bisa diklik untuk disalin — ikon muncul saat hover. */
function CopyablePath({ path }: { path: string }) {
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
function ProjectMenu({
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
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="More project actions"
              className={cn("rounded-full text-muted-foreground", className)}
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

/**
 * Empty state saat Project belum punya Session: kartu bergaris putus-putus
 * (ikon, judul, penjelasan singkat, satu aksi utama).
 */
function EmptySessions({ projectName, onStart }: { projectName: string; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-dashed bg-muted/20 px-6 py-12 text-center sm:py-16">
      <span
        className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        aria-hidden
      >
        <MessagesSquareIcon className="size-7" />
      </span>

      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">Start your first session</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A session is a conversation with the agent inside{" "}
          <span className="font-medium text-foreground">{projectName}</span>. It can read and edit
          files here for you.
        </p>
      </div>

      <Button type="button" onClick={onStart} className="rounded-full px-5">
        <PlusIcon data-icon="inline-start" />
        New session
      </Button>
    </div>
  );
}

export function SessionList({
  project: initialProject,
  onOpenSession,
  onDeleted,
}: SessionListProps) {
  /** Salinan lokal agar perubahan (mis. instruksi) langsung tampil. */
  const [project, setProject] = useState(initialProject);
  useEffect(() => setProject(initialProject), [initialProject]);
  const list = useSessionList({ projectId: project.id, onDeleted });
  /** Form pembuatan Session — dialog, dibuka lewat tombol. */
  const [formOpen, setFormOpen] = useState(false);
  const openForm = () => setFormOpen(true);

  const hasSessions = !list.loading && !list.loadError && list.ordered.length > 0;
  /** Layar lebar: panel samping inline. Sempit: panel di Sheet (tombol header). */
  const wide = useMediaQuery(WIDE_QUERY);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sidePanel = <ProjectSidePanel project={project} onProjectChange={setProject} />;

  return (
    // lg+: grid setinggi viewport; tiap kolom scroll sendiri (min-h-0).
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 pt-4 sm:pt-8 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-8 lg:min-h-0 lg:gap-0">
        {/* Header tetap di atas; hanya daftar Session yang scroll (lg+). */}
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
                <ProjectMenu
                  loading={list.loading}
                  onReload={() => void list.refresh()}
                  onDelete={list.openProjectDelete}
                />
                <Button type="button" onClick={openForm} className="rounded-full px-4">
                  <PlusIcon data-icon="inline-start" />
                  New session
                </Button>
              </div>
            )}
          </div>

          {/* Satu baris ringkasan — cukup teks, tanpa tile. Disembunyikan saat
              kosong: empty state di bawah sudah menyampaikannya. */}
          {!list.loading && !list.loadError && list.summary.total > 0 && (
            <p className="text-sm text-muted-foreground">{describeSessionSummary(list.summary)}</p>
          )}

          {/* Layar sempit: toolbar aksi sekunder di bawah judul. Aksi utama
              (New session) jadi tombol melayang kanan-bawah — area jempol. */}
          {!wide && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDetailsOpen(true)}
                aria-label="Project details: instructions, MCP servers, skills"
                className="h-10 rounded-full px-3.5"
              >
                <PanelRightIcon data-icon="inline-start" />
                Details
              </Button>
              <ProjectMenu
                className="size-10"
                loading={list.loading}
                onReload={() => void list.refresh()}
                onDelete={list.openProjectDelete}
              />
            </div>
          )}
        </header>

        <section
          aria-label="Sessions"
          // pb-24 (mobile): ruang agar baris terakhir tidak tertutup FAB.
          className="-mx-3 px-3 pb-24 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pb-16"
        >
          {list.loading ? (
            <SessionListSkeleton />
          ) : list.loadError ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load sessions</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                {list.loadError}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void list.refresh()}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : hasSessions ? (
            <ul className="-mx-3 flex flex-col">
              {list.ordered.map((session) => (
                <li key={session.id}>
                  <SessionRow
                    session={session}
                    busy={
                      list.stopping === session.id ||
                      list.starting === session.id ||
                      list.deleting === session.id
                    }
                    onOpen={() => onOpenSession(session)}
                    onStop={() => void list.stop(session.id)}
                    onStart={() => void list.start(session.id)}
                    onDelete={() => list.requestDelete(session)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptySessions projectName={project.name} onStart={openForm} />
          )}
        </section>
      </div>

      {/* Panel samping: Instructions, MCP, Skills (gaya Claude Projects). */}
      {wide ? (
        <aside
          aria-label="Project details"
          // Panel mandiri: padding sama di keempat sisi; scrollbar-gutter
          // stable di kedua tepi agar scrollbar tidak menggeser isi ke kiri.
          // Tanpa kotak pembungkus: tiap seksi sudah berupa kartu sendiri.
          // Scroll mandiri; pr kecil agar scrollbar tidak menempel ke kartu.
          className="-mr-2 min-h-0 overflow-y-auto overscroll-contain pr-2 pb-6 [scrollbar-width:thin]"
        >
          {sidePanel}
        </aside>
      ) : (
        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent side="right" className="w-[88vw] gap-0 overflow-y-auto sm:max-w-sm">
            <SheetHeader className="pb-2">
              <SheetTitle>{project.name}</SheetTitle>
              <SheetDescription>Instructions, MCP servers, and skills.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pt-2 pb-6">{sidePanel}</div>
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile/tablet: aksi utama melayang di kanan-bawah (jangkauan jempol,
          selalu terlihat saat scroll). Label teks tetap ada agar jelas —
          bukan ikon "+" tanpa arti. Safe-area iOS dihormati. */}
      {!wide && (
        <Button
          type="button"
          onClick={openForm}
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-12 rounded-full px-5 text-[15px] shadow-lg shadow-primary/25 sm:right-6 sm:bottom-6"
        >
          <PlusIcon data-icon="inline-start" className="size-5" />
          New session
        </Button>
      )}

      {/* Form pembuatan Session — dialog agar daftar tidak terdorong di HP */}
      <NewSessionDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={project.id}
        onCreated={() => {
          void list.refresh();
          notifyDataChanged();
        }}
      />

      {/* Konfirmasi hapus Session permanen */}
      <ConfirmSessionDeleteDialog
        open={list.pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) list.cancelDelete();
        }}
        deleting={list.deleting !== null}
        onConfirm={() => void list.confirmRemove()}
      />

      {/* Konfirmasi hapus Project (beserta seluruh Session-nya) */}
      <ConfirmDeleteProjectDialog
        open={list.projectDeleteOpen}
        onOpenChange={(open) => (open ? list.openProjectDelete() : list.closeProjectDelete())}
        projectName={project.name}
        sessionTotal={list.summary.total}
        deleting={list.deletingProject}
        onConfirm={() => void list.confirmRemoveProject()}
      />
    </div>
  );
}
