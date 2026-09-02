/**
 * Shell aplikasi KCG Bridge (task 25.1) dengan routing URL.
 *
 * Navigasi: `/` (daftar Project) -> `/projects/:projectId` (daftar Session)
 * -> `/projects/:projectId/sessions/:sessionId` (Session view).
 * - Route diparse dari `location.pathname` via `useRoute()`; tiap halaman
 *   me-resolve ulang datanya dari API sehingga refresh/direct link tetap
 *   berfungsi (server menyajikan shell SPA untuk semua path non-API).
 * - `use-theme.ts` (dark mode) dipakai lewat `ThemeToggle` (Req 8.2, 8.6).
 * - Header memuat tombol token otentikasi (opsional, Req 9.2/9.3): token
 *   disimpan di `localStorage` dan dipakai `apiFetch` + `use-websocket`.
 * - `SessionView` di-`key` per `session.id` agar remount saat pindah Session.
 */

import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { ProjectList } from "@/components/project-list";
import { ProjectSessionsPage } from "@/components/project-sessions-page";
import { SessionPage } from "@/components/session-page";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navigate, projectPath, projectsPath, sessionPath, useRoute } from "@/hooks/use-route";
import { getAuthToken, setAuthToken } from "@/lib/api";
import "./index.css";

import logo from "./logo.svg";

export function App() {
  const route = useRoute();
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState(getAuthToken() ?? "");

  const openProject = (projectId: string) => navigate(projectPath(projectId));
  const openSession = (projectId: string, sessionId: string) =>
    navigate(sessionPath(projectId, sessionId));

  const saveToken = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthToken(token);
    setTokenOpen(false);
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <a
          href={projectsPath()}
          onClick={(e) => {
            e.preventDefault();
            navigate(projectsPath());
          }}
          className="flex min-w-0 items-center gap-2"
          aria-label="Kembali ke daftar Project"
        >
          <img src={logo} alt="KCG Bridge" className="size-7" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold leading-tight">KCG Bridge</span>
            <span className="truncate text-[11px] leading-tight text-muted-foreground">
              Kontrol CLI_Agent dari HP
            </span>
          </div>
        </a>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setTokenOpen((o) => !o)}
            aria-label="Pengaturan token otentikasi"
            title="Token otentikasi"
            data-active={tokenOpen}
          >
            <KeyRoundIcon data-icon="inline-start" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Input token (opsional, Requirement 9.2/9.3) */}
      {tokenOpen && (
        <form
          onSubmit={saveToken}
          className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-2"
        >
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token otentikasi (kosongkan untuk menghapus)"
            aria-label="Token otentikasi"
            type="password"
            autoComplete="off"
            className="h-8"
          />
          <Button type="submit" size="sm">
            Simpan
          </Button>
        </form>
      )}

      {/* Konten per URL */}
      {route.name === "session" ? (
        <SessionPage
          key={`${route.projectId}/${route.sessionId}`}
          projectId={route.projectId}
          sessionId={route.sessionId}
        />
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl p-4 pb-12">
            {route.name === "projects" && (
              <ProjectList onOpenProject={(project) => openProject(project.id)} />
            )}
            {route.name === "project" && (
              <ProjectSessionsPage
                key={route.projectId}
                projectId={route.projectId}
                onOpenSession={(session) => openSession(route.projectId, session.id)}
              />
            )}
            {route.name === "not-found" && <NotFoundView />}
          </div>
        </main>
      )}
    </div>
  );
}

function NotFoundView() {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">Halaman tidak ditemukan.</p>
      <a
        href={projectsPath()}
        onClick={(e) => {
          e.preventDefault();
          navigate(projectsPath());
        }}
        className="text-sm font-medium underline underline-offset-4"
      >
        Kembali ke daftar Project
      </a>
    </div>
  );
}

export default App;
