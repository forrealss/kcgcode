/**
 * Daftar & pembuatan Session milik sebuah Project (Requirement 1.1, 1.3, 1.5).
 *
 * - `GET /api/sessions` di-filter per `projectId` (Requirement 1.5).
 * - Form pilih tipe CLI_Agent (`opencode` | `claude-code`) lalu
 *   `POST /api/sessions` — direktori kerja memakai path Project
 *   (Requirement 10.9), tipe tidak didukung ditolak (1.3).
 * - `DELETE /api/sessions/:id` menghentikan Session (Requirement 1.6).
 */

import { PlayIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import type { AgentType, Project, Session, SessionStatus } from "@/server/types";

export interface SessionListProps {
  project: Project;
  onOpenSession: (session: Session) => void;
  onBack: () => void;
}

const AGENT_TYPES: AgentType[] = ["opencode", "claude-code"];

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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);

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

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agentType, projectId: project.id }),
      });
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
      await apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Gagal menghentikan Session");
    } finally {
      setStopping(null);
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

      {/* Form pembuatan Session */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlayIcon className="size-4" data-icon="inline-start" />
            Session Baru
          </CardTitle>
          <CardDescription>
            Pilih tipe CLI_Agent. Direktori kerja otomatis memakai path Project.
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
            </FieldGroup>
            <div className="flex justify-end">
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

      {/* Daftar Session */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Session ({sessions.length})</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={refresh}
            aria-label="Muat ulang"
          >
            <RefreshCwIcon data-icon="inline-start" />
          </Button>
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
                Buat Session pertama untuk menjalankan CLI_Agent di Project ini.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((session) => (
              <Card key={session.id} className="gap-3 py-4">
                <CardContent className="flex items-center justify-between gap-3 px-4">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{session.agentType}</span>
                      <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      dibuat {formatTime(session.createdAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {session.status === "running" && (
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
                    )}
                    <Button type="button" size="sm" onClick={() => onOpenSession(session)}>
                      Buka
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
