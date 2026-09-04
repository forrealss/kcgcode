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
 * - Form pilih tipe CLI_Agent (`opencode` | `claude-code`) + model LLM
 *   (`GET /api/projects/:id/models`, dimuat malas saat dropdown dibuka)
 *   lalu `POST /api/sessions` — direktori kerja memakai path Project
 *   (Requirement 10.9), tipe tidak didukung ditolak (1.3). Di layar HP form
 *   ini tampil sebagai dialog agar tidak mendorong daftar ke bawah.
 * - `POST /api/sessions/:id/stop` menghentikan Session (Requirement 1.6);
 *   `DELETE /api/sessions/:id` menghapus permanen (termasuk di opencode);
 *   `POST /api/sessions/:id` menghidupkan kembali (resume).
 * - `DELETE /api/projects/:id` menghapus pendaftaran Project beserta seluruh
 *   Session-nya (direktori kerja di filesystem tidak disentuh).
 * - Hapus Session/Project dikonfirmasi lewat `AlertDialog` (bukan
 *   `window.confirm`) agar konsisten dengan komponen shadcn/ui lain.
 */

import {
  ArrowLeftIcon,
  BotIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelSearchList } from "@/components/sessions/ModelSearchList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { keyOfSessionModel } from "@/lib/model-picker";
import { formatRelativeTime } from "@/lib/project-overview";
import {
  describeSessionModel,
  describeSessionSummary,
  sortSessions,
  summarizeSessions,
} from "@/lib/session-summary";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/server/services/opencode-client";
import type { AgentType, Project, Session, SessionModel, SessionStatus } from "@/types";

export interface SessionListProps {
  project: Project;
  onOpenSession: (session: Session) => void;
  onBack: () => void;
  /** Dipanggil setelah Project dihapus, untuk kembali ke daftar Project. */
  onDeleted?: () => void;
}

// v1 headless: hanya opencode (claude-code punya mekanisme headless sendiri).
const AGENT_TYPES: AgentType[] = ["opencode"];

const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "Berjalan",
  stopped: "Berhenti",
  crashed: "Crash",
};

const STATUS_DOT: Record<SessionStatus, string> = {
  running: "bg-emerald-500",
  stopped: "bg-muted-foreground/50",
  crashed: "bg-destructive",
};

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function SessionList({ project, onOpenSession, onBack, onDeleted }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentType, setAgentType] = useState<AgentType>("opencode");
  /** Model pilihan untuk Session baru; null = default opencode. */
  const [selectedModel, setSelectedModel] = useState<SessionModel | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Session yang akan dihapus, dikonfirmasi lewat `AlertDialog`. */
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  /** Konfirmasi hapus Project (beserta seluruh Session-nya). */
  const [projectDeleteOpen, setProjectDeleteOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  /** Form pembuatan Session — dialog, dibuka lewat tombol. */
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/sessions");
      const body = (await res.json()) as { sessions: Session[] };
      setSessions(body.sessions.filter((s) => s.projectId === project.id));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Gagal memuat daftar Session");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Running -> crashed -> stopped, terbaru di atas (lib/session-summary.ts).
  const ordered = useMemo(() => sortSessions(sessions), [sessions]);
  const summary = useMemo(() => summarizeSessions(sessions), [sessions]);

  /**
   * Muat daftar model dari server headless Project. Dipanggil malas (lazy)
   * saat dropdown model dibuka agar server tidak di-spawn bila user tidak
   * memilih model. Setelah termuat, hasil dipakai ulang.
   */
  const loadModels = useCallback(async () => {
    if (models !== null || modelsLoading) return;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/models`);
      const body = (await res.json()) as { models: ModelOption[] };
      setModels(body.models);
    } catch (e) {
      setModelsError(e instanceof ApiError ? e.message : "Gagal memuat daftar model");
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [project.id, models, modelsLoading]);

  /**
   * Buka form + muat daftar model. Daftar kini tersemat (bukan dropdown),
   * jadi ia perlu terisi begitu dialog tampil — tetap malas dalam arti server
   * headless hanya di-spawn saat user benar-benar membuat Session.
   */
  const openForm = () => {
    setCreateError(null);
    setFormOpen(true);
    void loadModels();
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agentType, projectId: project.id, model: selectedModel }),
      });
      setFormOpen(false);
      await refresh();
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Gagal membuat Session");
    } finally {
      setCreating(false);
    }
  };

  const stop = async (sessionId: string) => {
    setStopping(sessionId);
    setActionError(null);
    try {
      // Stop ≠ hapus: POST /stop hanya mengubah status; data tetap ada dan
      // bisa dihidupkan kembali lewat aksi Hidupkan (resume).
      await apiFetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
      await refresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Gagal menghentikan Session");
    } finally {
      setStopping(null);
    }
  };

  /** Resume Session stopped/crashed: POST /api/sessions/:id. */
  const start = async (sessionId: string) => {
    setStarting(sessionId);
    setActionError(null);
    try {
      await apiFetch(`/api/sessions/${sessionId}`, { method: "POST" });
      await refresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Gagal menghidupkan Session");
    } finally {
      setStarting(null);
    }
  };

  /**
   * Hapus Session permanen — menghapus juga session (dan riwayat pesannya)
   * di server headless opencode. Dikonfirmasi via `AlertDialog` sebelum
   * eksekusi karena tidak bisa dibatalkan.
   */
  const confirmRemove = async () => {
    const session = pendingDelete;
    if (!session) return;
    setDeleting(session.id);
    setActionError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Gagal menghapus Session");
    } finally {
      setDeleting(null);
    }
  };

  /**
   * Hapus pendaftaran Project. Server membersihkan seluruh Session (termasuk
   * sesi remote opencode) lebih dulu; direktori kerja di filesystem tetap ada.
   */
  const confirmRemoveProject = async () => {
    setDeletingProject(true);
    setActionError(null);
    try {
      await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      setProjectDeleteOpen(false);
      onDeleted?.();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Gagal menghapus Project");
    } finally {
      setDeletingProject(false);
    }
  };

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
            aria-label="Kembali ke daftar Project"
            className="shrink-0"
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight">{project.name}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {loading ? "Memuat session…" : describeSessionSummary(summary)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Aksi project"
                className="shrink-0"
              >
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void refresh()} disabled={loading}>
                <RefreshCwIcon />
                Muat ulang
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setProjectDeleteOpen(true)}>
                <Trash2Icon />
                Hapus project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="truncate rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {project.path}
        </p>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Aksi gagal</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* Daftar Session */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Session</h2>
            {!loading && !loadError && summary.total > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {summary.total}
              </span>
            )}
          </div>
          <Button type="button" size="sm" onClick={openForm} className="shrink-0">
            <PlusIcon data-icon="inline-start" />
            Session baru
          </Button>
        </div>

        {loading ? (
          <SessionListSkeleton />
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat Session</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : ordered.length === 0 ? (
          <Empty className="rounded-xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>Belum ada Session</EmptyTitle>
              <EmptyDescription>
                Buat Session untuk menjalankan CLI_Agent di Project ini.
              </EmptyDescription>
              <EmptyContent>
                <Button type="button" onClick={openForm}>
                  <PlusIcon data-icon="inline-start" />
                  Session baru
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map((session) => (
              <li key={session.id}>
                <SessionRow
                  session={session}
                  busy={
                    stopping === session.id || starting === session.id || deleting === session.id
                  }
                  onOpen={() => onOpenSession(session)}
                  onStop={() => void stop(session.id)}
                  onStart={() => void start(session.id)}
                  onDelete={() => setPendingDelete(session)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Form pembuatan Session — dialog agar daftar tidak terdorong di HP */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setCreateError(null);
        }}
      >
        {/* Tinggi dipatok: daftar model bisa panjang, jadi ia yang men-scroll
            di dalam dialog — bukan dialog yang tumbuh melewati layar HP. */}
        <DialogContent className="flex h-[80dvh] max-h-[620px] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Session baru</DialogTitle>
            <DialogDescription>
              Session berjalan di server headless OpenCode dengan direktori kerja path Project.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="flex min-h-0 flex-1 flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="agent-type">Tipe CLI_Agent</FieldLabel>
              <Select value={agentType} onValueChange={(v) => setAgentType(v as AgentType)}>
                <SelectTrigger id="agent-type" className="w-full">
                  <SelectValue placeholder="Pilih tipe" />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <FieldLabel>Model</FieldLabel>
              {modelsError ? (
                <Alert variant="destructive">
                  <AlertTitle>Gagal memuat model</AlertTitle>
                  <AlertDescription>{modelsError}</AlertDescription>
                </Alert>
              ) : (
                <ModelSearchList
                  models={models}
                  loading={modelsLoading}
                  activeKey={keyOfSessionModel(selectedModel)}
                  onSelect={setSelectedModel}
                  disabled={creating}
                  className="flex-1"
                />
              )}
            </div>

            {createError && (
              <Alert variant="destructive">
                <AlertTitle>Gagal membuat Session</AlertTitle>
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFormOpen(false)}
                disabled={creating}
              >
                Batal
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Membuat…
                  </>
                ) : (
                  "Buat Session"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi hapus Session permanen */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Session ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Riwayat percakapan di server opencode juga ikut terhapus permanen. Aksi ini tidak bisa
              dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting !== null}>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirmRemove();
              }}
              disabled={deleting !== null}
            >
              {deleting !== null ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Menghapus…
                </>
              ) : (
                "Hapus permanen"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi hapus Project (beserta seluruh Session-nya) */}
      <AlertDialog
        open={projectDeleteOpen}
        onOpenChange={(open) => {
          if (!deletingProject) setProjectDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus project “{project.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {summary.total > 0
                ? `${summary.total} session milik project ini ikut dihapus permanen, termasuk riwayat percakapannya di server opencode. `
                : ""}
              Folder kerja di server tidak dihapus — hanya pendaftaran project di KCG Bridge. Aksi
              ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingProject}>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirmRemoveProject();
              }}
              disabled={deletingProject}
            >
              {deletingProject ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Menghapus…
                </>
              ) : (
                "Hapus project"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SessionRowProps {
  session: Session;
  /** Ada aksi berjalan untuk Session ini — kunci baris agar tidak dobel klik. */
  busy: boolean;
  onOpen: () => void;
  onStop: () => void;
  onStart: () => void;
  onDelete: () => void;
}

/**
 * Satu baris Session. Badan baris adalah tombol buka (target sentuh lebar),
 * aksi sekunder dikumpulkan di menu "..." — di layar HP deretan tombol ikon
 * kecil sulit ditekan dan mudah salah sentuh.
 */
function SessionRow({ session, busy, onOpen, onStop, onStart, onDelete }: SessionRowProps) {
  const running = session.status === "running";

  return (
    <div className="group flex items-center gap-1 rounded-xl border bg-card pr-1 shadow-sm transition-all focus-within:border-primary/40 hover:border-primary/40 hover:shadow-md">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 sm:px-4"
        aria-label={`Buka session ${session.agentType}`}
      >
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {busy ? <Spinner className="size-4" /> : <BotIcon />}
          {running && !busy && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
              aria-hidden
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{session.agentType}</span>
            <StatusBadge status={session.status} />
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {describeSessionModel(session)} · {formatRelativeTime(session.updatedAt)}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Aksi session ${session.agentType}`}
            className="shrink-0"
          >
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {running ? (
            <DropdownMenuItem onSelect={onStop}>
              <SquareIcon />
              Hentikan
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onStart}>
              <PlayIcon />
              Hidupkan
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            Hapus permanen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Placeholder daftar Session saat memuat — menjaga tinggi konten. */
function SessionListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="size-8 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}
