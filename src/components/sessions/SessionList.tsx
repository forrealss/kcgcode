/**
 * Daftar & pembuatan Session milik sebuah Project (Requirement 1.1, 1.3, 1.5).
 *
 * Halaman detail Project. Fokus: melanjutkan Session yang sudah ada, dengan
 * navigasi yang nyaman di layar HP.
 * - Seluruh baris Session dapat diketuk untuk membuka (target sentuh besar);
 *   aksi sekunder (stop/start/hapus) dikumpulkan di menu "..." supaya tidak
 *   ada deretan tombol ikon kecil berdempetan di layar sempit.
 * - Header Project: nama + path, tombol "New session" dan menu aksi Project
 *   (reload, hapus). Tanpa tombol back — navigasi lewat sidebar. Di bawahnya
 *   chip ringkasan status; daftar Session berupa baris polos (hover bg).
 * - `GET /api/sessions` di-filter per `projectId` (Requirement 1.5), lalu
 *   diurutkan `lib/session-summary.ts`: running -> crashed -> stopped.
 *
 * File ini hanya menyusun area dari bagian yang sudah dipisah:
 * - State & aksi daftar: `hooks/useSessionList.ts`.
 * - Form pembuatan Session: `NewSessionDialog.tsx`.
 * - Satu baris Session: `SessionRow.tsx`; dialog konfirmasi hapus:
 *   `ConfirmSessionDeleteDialog.tsx` & `ConfirmDeleteProjectDialog.tsx`.
 */
import {
  BotIcon,
  FolderIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useSessionList } from "@/hooks/useSessionList";
import { cn } from "@/lib/utils";
import type { Project, Session } from "@/types";

export interface SessionListProps {
  project: Project;
  onOpenSession: (session: Session) => void;
  /** Dipanggil setelah Project dihapus, untuk kembali ke daftar Project. */
  onDeleted?: () => void;
}

/** Chip ringkasan status (mis. "● Running 2"). */
function SummaryChip({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
      {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />}
      {label}
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </span>
  );
}

export function SessionList({ project, onOpenSession, onDeleted }: SessionListProps) {
  const list = useSessionList({ projectId: project.id, onDeleted });
  /** Form pembuatan Session — dialog, dibuka lewat tombol. */
  const [formOpen, setFormOpen] = useState(false);

  const openForm = () => setFormOpen(true);

  return (
    <div className="flex flex-col gap-5">
      {/* Header Project: identitas + aksi. Tanpa tombol back — navigasi lewat
          sidebar. Aksi utama (New session) langsung terlihat di kanan. */}
      <header className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderIcon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-xl font-semibold leading-tight tracking-tight">
            {project.name}
          </h1>
          <p className="truncate font-mono text-xs text-muted-foreground" title={project.path}>
            {project.path}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" onClick={openForm} className="hidden sm:inline-flex">
            <PlusIcon data-icon="inline-start" />
            New session
          </Button>
          <Button
            type="button"
            size="icon-sm"
            onClick={openForm}
            aria-label="New session"
            className="sm:hidden"
          >
            <PlusIcon />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Project actions">
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void list.refresh()} disabled={list.loading}>
                <RefreshCwIcon />
                Reload
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={list.openProjectDelete}>
                <Trash2Icon />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Ringkasan status — chip kecil, hanya yang bernilai > 0. Tiap chip
          sudah punya teks label sendiri, jadi wrapper tak perlu aria-label. */}
      {!list.loading && !list.loadError && list.summary.total > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <SummaryChip label="Total" value={list.summary.total} />
          {list.summary.running > 0 && (
            <SummaryChip label="Running" value={list.summary.running} dot="bg-emerald-500" />
          )}
          {list.summary.crashed > 0 && (
            <SummaryChip label="Crashed" value={list.summary.crashed} dot="bg-destructive" />
          )}
          {list.summary.stopped > 0 && (
            <SummaryChip
              label="Stopped"
              value={list.summary.stopped}
              dot="bg-muted-foreground/50"
            />
          )}
        </div>
      )}

      {list.actionError && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{list.actionError}</AlertDescription>
        </Alert>
      )}

      {/* Daftar Session */}
      <section className="flex flex-col gap-2" aria-labelledby="session-list-heading">
        <h2
          id="session-list-heading"
          className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          Sessions
        </h2>

        {list.loading ? (
          <SessionListSkeleton />
        ) : list.loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load sessions</AlertTitle>
            <AlertDescription>{list.loadError}</AlertDescription>
          </Alert>
        ) : list.ordered.length === 0 ? (
          <Empty className="rounded-xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>No sessions yet</EmptyTitle>
              <EmptyDescription>
                Create a session to run CLI_Agent in this project.
              </EmptyDescription>
              <EmptyContent>
                <Button type="button" onClick={openForm}>
                  <PlusIcon data-icon="inline-start" />
                  New session
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-0.5">
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
        )}
      </section>

      {/* Form pembuatan Session — dialog agar daftar tidak terdorong di HP */}
      <NewSessionDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={project.id}
        onCreated={() => void list.refresh()}
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
