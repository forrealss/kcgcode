/**
 * Daftar & pembuatan Session milik sebuah Project (Requirement 1.1, 1.3, 1.5).
 *
 * Halaman detail Project. Fokus: melanjutkan Session yang sudah ada, dengan
 * navigasi yang nyaman di layar HP.
 * - Seluruh baris Session dapat diketuk untuk membuka (target sentuh besar);
 *   aksi sekunder (stop/start/hapus) dikumpulkan di menu "..." supaya tidak
 *   ada deretan tombol ikon kecil berdempetan di layar sempit.
 * - Header Project menampilkan ringkasan status + aksi Project (termasuk
 *   hapus Project) dan tombol kembali yang selalu terlihat.
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
  ArrowLeftIcon,
  BotIcon,
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
import { describeSessionSummary } from "@/lib/session-summary";
import type { Project, Session } from "@/types";

export interface SessionListProps {
  project: Project;
  onOpenSession: (session: Session) => void;
  onBack: () => void;
  /** Dipanggil setelah Project dihapus, untuk kembali ke daftar Project. */
  onDeleted?: () => void;
}

export function SessionList({ project, onOpenSession, onBack, onDeleted }: SessionListProps) {
  const list = useSessionList({ projectId: project.id, onDeleted });
  /** Form pembuatan Session — dialog, dibuka lewat tombol. */
  const [formOpen, setFormOpen] = useState(false);

  const openForm = () => setFormOpen(true);

  return (
    <div className="flex flex-col gap-5">
      {/* Header Project: kembali + identitas + aksi Project */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to projects"
            className="shrink-0"
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold leading-tight">{project.name}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {list.loading ? "Loading sessions…" : describeSessionSummary(list.summary)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Project actions"
                className="shrink-0"
              >
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
        <p className="truncate rounded-md bg-muted/50 px-2 py-1.5 font-mono text-xs text-muted-foreground">
          {project.path}
        </p>
      </div>

      {list.actionError && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{list.actionError}</AlertDescription>
        </Alert>
      )}

      {/* Daftar Session */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium text-muted-foreground">Session</h2>
            {!list.loading && !list.loadError && list.summary.total > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
                {list.summary.total}
              </span>
            )}
          </div>
          <Button type="button" size="sm" onClick={openForm} className="shrink-0">
            <PlusIcon data-icon="inline-start" />
            New session
          </Button>
        </div>

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
          <ul className="flex flex-col gap-2">
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
      </div>

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
