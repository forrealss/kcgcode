/**
 * Daftar & pembuatan Session milik sebuah Project (Requirement 1.1, 1.3, 1.5).
 *
 * - `GET /api/sessions` di-filter per `projectId` (Requirement 1.5).
 * - Form pilih tipe CLI_Agent (`opencode` | `claude-code`) + model LLM
 *   (`GET /api/projects/:id/models`, dimuat malas saat dropdown dibuka)
 *   lalu `POST /api/sessions` — direktori kerja memakai path Project
 *   (Requirement 10.9), tipe tidak didukung ditolak (1.3).
 * - `POST /api/sessions/:id/stop` menghentikan Session (Requirement 1.6);
 *   `DELETE /api/sessions/:id` menghapus permanen (termasuk di opencode);
 *   `POST /api/sessions/:id` menghidupkan kembali (resume).
 * - Hapus Session dikonfirmasi lewat `AlertDialog` (bukan `window.confirm`)
 *   agar konsisten dengan komponen shadcn/ui lain di aplikasi.
 */

import { BotIcon, PlayIcon, RefreshCwIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/server/services/opencode-client";
import type { AgentType, Project, Session, SessionModel, SessionStatus } from "@/types";

export interface SessionListProps {
  project: Project;
  onOpenSession: (session: Session) => void;
  onBack: () => void;
}

// v1 headless: hanya opencode (claude-code punya mekanisme headless sendiri).
const AGENT_TYPES: AgentType[] = ["opencode"];

/** Nilai Select model: "default" = tidak mengirim model (pakai default opencode). */
const DEFAULT_MODEL = "default";

/** Kunci gabungan provider+model untuk nilai Select (modelID boleh berisi "/"). */
function modelKey(m: ModelOption): string {
  return `${m.providerID}\u0000${m.modelID}`;
}

/**
 * Nilai Select -> `SessionModel` untuk body API; `DEFAULT_MODEL` -> null
 * (biarkan opencode memakai model default-nya).
 */
function parseModelKey(key: string): SessionModel | null {
  if (key === DEFAULT_MODEL) return null;
  const [providerID, modelID] = key.split("\u0000");
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

/** Kelompokkan model per provider untuk SelectGroup. */
function groupModels(
  models: ModelOption[],
): { providerID: string; providerName: string; models: ModelOption[] }[] {
  const byProvider = new Map<
    string,
    { providerID: string; providerName: string; models: ModelOption[] }
  >();
  for (const m of models) {
    let g = byProvider.get(m.providerID);
    if (!g) {
      g = { providerID: m.providerID, providerName: m.providerName, models: [] };
      byProvider.set(m.providerID, g);
    }
    g.models.push(m);
  }
  return [...byProvider.values()];
}

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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionList({ project, onOpenSession, onBack }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentType, setAgentType] = useState<AgentType>("opencode");
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Session yang akan dihapus, dikonfirmasi lewat `AlertDialog` sebelum eksekusi. */
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  /** Form pembuatan disembunyikan secara default — dibuka lewat tombol. */
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

  const openForm = () => {
    setCreateError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setCreateError(null);
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    const chosen = parseModelKey(selectedModel);
    try {
      await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agentType, projectId: project.id, model: chosen }),
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
    try {
      // Stop ≠ hapus: POST /stop hanya mengubah status; data tetap ada dan
      // bisa dihidupkan kembali lewat tombol Start (resume).
      await apiFetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
      await refresh();
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Gagal menghentikan Session");
    } finally {
      setStopping(null);
    }
  };

  /** Resume Session stopped/crashed: POST /api/sessions/:id. */
  const start = async (sessionId: string) => {
    setStarting(sessionId);
    setStartError(null);
    try {
      await apiFetch(`/api/sessions/${sessionId}`, { method: "POST" });
      await refresh();
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "Gagal menghidupkan Session");
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
    setStartError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "Gagal menghapus Session");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header Project */}
      <div className="flex items-start justify-between gap-3 rounded-xl border bg-card px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BotIcon />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{project.name}</h1>
            <p className="truncate font-mono text-xs text-muted-foreground">{project.path}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          Kembali
        </Button>
      </div>

      {/* Daftar Session — tampil duluan; form dibuka lewat tombol */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Session</h2>
            {!loading && !loadError && sessions.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {sessions.length}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={refresh}
                  aria-label="Muat ulang daftar Session"
                  disabled={loading}
                >
                  <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Muat ulang</TooltipContent>
            </Tooltip>
            <Button type="button" size="sm" onClick={openForm}>
              <PlayIcon data-icon="inline-start" />
              Session Baru
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Memuat…
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Gagal memuat Session</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : sessions.length === 0 ? (
          <Empty className="rounded-xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlayIcon />
              </EmptyMedia>
              <EmptyTitle>Belum ada Session</EmptyTitle>
              <EmptyDescription>
                Buat Session untuk menjalankan CLI_Agent di Project ini.
              </EmptyDescription>
              <EmptyContent>
                <Button type="button" size="sm" onClick={openForm}>
                  <PlayIcon data-icon="inline-start" />
                  Session Baru
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {startError && (
              <Alert variant="destructive">
                <AlertTitle>Gagal menghidupkan Session</AlertTitle>
                <AlertDescription>{startError}</AlertDescription>
              </Alert>
            )}
            {sessions.map((session) => (
              <div
                key={session.id}
                className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BotIcon />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{session.agentType}</span>
                    <StatusBadge status={session.status} />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {session.model ? session.model.modelID : "model default"} · dibuat{" "}
                    {formatTime(session.createdAt)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {session.status === "running" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => stop(session.id)}
                          disabled={stopping === session.id}
                          aria-label={`Hentikan session ${session.agentType}`}
                        >
                          {stopping === session.id ? (
                            <Spinner className="size-4" />
                          ) : (
                            <SquareIcon />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Hentikan</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => start(session.id)}
                          disabled={starting === session.id}
                          aria-label={`Hidupkan session ${session.agentType}`}
                        >
                          {starting === session.id ? <Spinner className="size-4" /> : <PlayIcon />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Hidupkan</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setPendingDelete(session)}
                        disabled={deleting === session.id}
                        aria-label={`Hapus session ${session.agentType}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        {deleting === session.id ? <Spinner className="size-4" /> : <Trash2Icon />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Hapus permanen</TooltipContent>
                  </Tooltip>
                  <Button type="button" size="sm" onClick={() => onOpenSession(session)}>
                    Buka
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form pembuatan Session — muncul saat tombol "Session Baru" ditekan */}
      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlayIcon className="size-4" data-icon="inline-start" />
              Session Baru
            </CardTitle>
            <CardDescription>
              Pilih tipe CLI_Agent dan model LLM. Session berjalan di server headless OpenCode
              dengan direktori kerja path Project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="flex flex-col gap-4">
              <FieldGroup>
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
                <Field>
                  <FieldLabel htmlFor="session-model">Model</FieldLabel>
                  <Select
                    value={selectedModel}
                    onValueChange={setSelectedModel}
                    onOpenChange={(open) => {
                      if (open) void loadModels();
                    }}
                  >
                    <SelectTrigger id="session-model" className="w-full">
                      <SelectValue placeholder="Pilih model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_MODEL}>Default opencode</SelectItem>
                      {modelsLoading && (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                          <Spinner className="size-3" />
                          Memuat model…
                        </div>
                      )}
                      {modelsError && (
                        <div className="px-2 py-1.5 text-xs text-destructive">{modelsError}</div>
                      )}
                      {groupModels(models ?? []).map((g) => (
                        <SelectGroup key={g.providerID}>
                          <SelectLabel>{g.providerName}</SelectLabel>
                          {g.models.map((m) => (
                            <SelectItem key={modelKey(m)} value={modelKey(m)}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeForm} disabled={creating}>
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
              </div>
            </form>
            {createError && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Gagal membuat Session</AlertTitle>
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
