/**
 * Daftar & pembuatan Project (Requirement 10.4-10.8).
 *
 * - `GET /api/projects` untuk daftar (Requirement 10.8).
 * - Form nama Project + Folder_Browser untuk memilih path dalam Sandbox_Root
 *   (Requirement 10.2-10.4); `POST /api/projects` untuk membuat (10.4).
 * - Error validasi (nama/path duplikat, di luar sandbox, dst.) ditampilkan
 *   lewat Alert (10.5, 10.6, 10.7).
 */

import { FolderPlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import type { Project } from "@/server/types";
import { FolderBrowser } from "./folder-browser";

export interface ProjectListProps {
  /** Navigasi ke daftar Session milik Project yang dipilih. */
  onOpenProject: (project: Project) => void;
}

export function ProjectList({ onOpenProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Form pembuatan disembunyikan secara default — dibuka lewat tombol. */
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/projects");
      const body = (await res.json()) as { projects: Project[] };
      setProjects(body.projects);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Gagal memuat daftar Project");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      await apiFetch("/api/projects", { method: "POST", body: JSON.stringify({ name, path }) });
      setName("");
      setPath("");
      setFormOpen(false);
      await refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Gagal membuat Project");
    } finally {
      setCreating(false);
    }
  };

  const openForm = () => {
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setFormError(null);
    setName("");
    setPath("");
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Daftar Project — selalu tampil di halaman `/` */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Project ({projects.length})</h2>
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
              <FolderPlusIcon data-icon="inline-start" />
              Project Baru
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
            <AlertTitle>Gagal memuat Project</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : projects.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderPlusIcon />
              </EmptyMedia>
              <EmptyTitle>Belum ada Project</EmptyTitle>
              <EmptyDescription>
                Tambahkan Project untuk mulai menjalankan CLI_Agent — atau gunakan tombol "Project
                Baru" di atas.
              </EmptyDescription>
              <EmptyContent>
                <Button type="button" size="sm" onClick={openForm}>
                  <FolderPlusIcon data-icon="inline-start" />
                  Project Baru
                </Button>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((project) => (
              <Card key={project.id} className="gap-3 py-4">
                <CardContent className="flex items-center justify-between gap-3 px-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium">{project.name}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {project.path}
                    </span>
                  </div>
                  <Button type="button" size="sm" onClick={() => onOpenProject(project)}>
                    Buka
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Form pembuatan Project — muncul saat tombol "Project Baru" ditekan */}
      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderPlusIcon className="size-4" data-icon="inline-start" />
              Project Baru
            </CardTitle>
            <CardDescription>
              Pilih direktori kerja di dalam Sandbox_Root, lalu beri nama Project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="project-name">Nama Project</FieldLabel>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="mis. web-app"
                    maxLength={120}
                    autoFocus
                  />
                </Field>
                <Field>
                  <FieldLabel>Direktori Kerja</FieldLabel>
                  <FolderBrowser selectedPath={path} onPick={setPath} />
                </Field>
              </FieldGroup>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeForm} disabled={creating}>
                  <XIcon data-icon="inline-start" />
                  Batal
                </Button>
                <Button type="submit" disabled={creating || name.trim() === ""}>
                  {creating ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Membuat…
                    </>
                  ) : (
                    "Buat Project"
                  )}
                </Button>
              </div>
            </form>
            {formError && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Gagal membuat Project</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
