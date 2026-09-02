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
 */

import { PlayIcon, RefreshCwIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { ApiError, apiFetch } from "@/lib/api";
import type { ModelOption } from "@/server/opencode-client";
import type { AgentType, Project, Session, SessionModel, SessionStatus } from "@/server/types";

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

function statusVariant(status: SessionStatus): "default" | "secondary" | "destructive" {
  if (status === "running") return "default";
  if (status === "crashed") return "destructive";
  return "secondary";
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
   * di server headless opencode. Konfirmasi dulu karena tidak bisa dibatalkan.
   */
  const remove = async (sessionId: string) => {
    if (
      !window.confirm(
        "Hapus Session ini permanen?\n\nRiwayat percakapan di server opencode juga ikut dihapus.",
      )
    ) {
      return;
    }
    setDeleting(sessionId);
    setStartError(null);
    try {
      await apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "Gagal menghapus Session");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{project.name}</h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{project.path}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Kembali
        </Button>
      </div>

      {/* Daftar Session — tampil duluan; form dibuka lewat tombol */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Session ({sessions.length})</h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={refresh}
              aria-label="Muat ulang"
            >
              <RefreshCwIcon data-icon="inline-start" />
            </Button>
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
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlayIcon />
              </EmptyMedia>
              <EmptyTitle>Belum ada Session</EmptyTitle>
              <EmptyDescription>
                Buat Session untuk menjalankan CLI_Agent di Project ini — atau gunakan tombol
                "Session Baru" di atas.
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
              <Card key={session.id} className="gap-3 py-4">
                <CardContent className="flex items-center justify-between gap-3 px-4">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{session.agentType}</span>
                      <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {session.model ? session.model.modelID : "model default"} · dibuat{" "}
                      {formatTime(session.createdAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {session.status === "running" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => stop(session.id)}
                        disabled={stopping === session.id}
                        aria-label={`Hentikan session ${session.agentType}`}
                      >
                        {stopping === session.id ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <SquareIcon data-icon="inline-start" />
                        )}
                        Stop
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => start(session.id)}
                        disabled={starting === session.id}
                        aria-label={`Hidupkan session ${session.agentType}`}
                      >
                        {starting === session.id ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <PlayIcon data-icon="inline-start" />
                        )}
                        Start
                      </Button>
                    )}
                    <Button type="button" size="sm" onClick={() => onOpenSession(session)}>
                      Buka
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(session.id)}
                      disabled={deleting === session.id}
                      aria-label={`Hapus session ${session.agentType}`}
                      title="Hapus permanen"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {deleting === session.id ? <Spinner className="size-4" /> : <Trash2Icon />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
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
    </div>
  );
}
