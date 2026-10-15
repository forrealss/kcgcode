/**
 * Halaman Skills (`/skills`) — jelajah & pasang skill dari skills.sh.
 *
 * - Header: judul + pemilih Project (pil "Install to"). Project terpilih =
 *   `?project=` (dari sidebar) > pilihan terakhir (localStorage) > satu-
 *   satunya Project. Pilihan memperbarui URL (`replaceState`).
 * - Skill terpasang dibaca dari KEDUA agent (OpenCode & Claude Code) lalu
 *   digabung (`mergeInstalledSkills`); tiap kartu menampilkan logo agent
 *   tempat skill itu terpasang. Agent tujuan dipilih di dialog Install.
 * - Dua tab memakai kolom cari yang sama, tapi query disimpan per tab:
 *   - Browse: hasil skills.sh (debounce, min. 2 karakter); saat kosong
 *     tampil chip saran kata kunci.
 *   - Installed: skill terpasang di Project (+ global), difilter lokal.
 * - Hasil berupa grid kartu 2 kolom (1 kolom di HP).
 * - Pintasan `/` memfokuskan kolom cari; Esc mengosongkannya.
 * - Install -> dialog konfirmasi (audit keamanan) -> job instalasi di latar
 *   (`lib/skill-installs`). Progres + output CLI tampil di notifikasi global;
 *   kartu menunjukkan "Installing…" dan daftar terpasang dimuat ulang saat
 *   job sukses.
 *
 * File ini hanya kerangka halaman + pemilihan Project; bagian lain dipisah:
 * - Area kerja per Project (tab, daftar terpasang, Install): `SkillsWorkspace.tsx`.
 * - Isi tab: `BrowsePanel.tsx` & `InstalledPanel.tsx`; tombol tab & kolom
 *   cari: `controls.tsx`.
 * - Pencarian skills.sh: `useSkillSearch.ts`; pintasan `/`: `useSlashFocus.ts`.
 */
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SkillsProjectPicker } from "@/components/skills/SkillsProjectPicker";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/hooks/useRouter";
import { apiFetch, errorText } from "@/lib/api";
import { parseSkillsProject, projectsPath, skillsPath } from "@/lib/routes";
import {
  readLastSkillsProject,
  resolveSkillsProject,
  storeLastSkillsProject,
} from "@/lib/skills-catalog";
import type { Project } from "@/types";
import { SkillsWorkspace } from "./SkillsWorkspace";

export function SkillsPage() {
  const { pathname, navigate } = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [urlProjectId, setUrlProjectId] = useState<string | null>(() =>
    parseSkillsProject(window.location.search),
  );

  // Sinkron dengan URL saat navigasi SPA ke /skills?project=... dari sidebar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname jadi trigger navigasi
  useEffect(() => {
    setUrlProjectId(parseSkillsProject(window.location.search));
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/projects")
      .then((res) => res.json() as Promise<{ projects: Project[] }>)
      .then(({ projects }) => {
        if (!cancelled) setProjects(projects);
      })
      .catch((e) => {
        if (!cancelled) {
          setProjects([]);
          setProjectsError(errorText(e, "Failed to load projects"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => (projects ? resolveSkillsProject(projects, urlProjectId, readLastSkillsProject()) : null),
    [projects, urlProjectId],
  );

  // Pilihan hasil fallback (tersimpan / satu-satunya) ikut ditulis ke URL.
  useEffect(() => {
    if (selected && selected.id !== urlProjectId) {
      window.history.replaceState({}, "", skillsPath(selected.id));
      setUrlProjectId(selected.id);
    }
  }, [selected, urlProjectId]);

  const choose = useCallback((id: string) => {
    storeLastSkillsProject(id);
    setUrlProjectId(id);
    window.history.replaceState({}, "", skillsPath(id));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header: judul di kiri, tujuan instalasi (pil) di kanan — konteks
          halaman, terpisah jelas dari kolom cari di bawah tab. */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
          <p className="text-sm text-muted-foreground">
            Discover skills on{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-4"
            >
              skills.sh
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            and add them to your project's agent.
          </p>
        </div>
        {projects === null ? (
          <Skeleton className="h-9 w-48 shrink-0 rounded-full" />
        ) : (
          projects.length > 0 && (
            <div className="min-w-0 shrink-0">
              <SkillsProjectPicker projects={projects} selected={selected} onSelect={choose} />
            </div>
          )
        )}
      </header>

      {projects === null ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ) : projects.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlusIcon />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              {projectsError ?? "Skills are installed per project. Create a project first."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={() => navigate(projectsPath())}>
              Go to projects
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        // Remount per Project: pencarian & daftar terpasang tidak bocor.
        <SkillsWorkspace key={selected?.id ?? "none"} project={selected} />
      )}
    </div>
  );
}
