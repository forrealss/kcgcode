/**
 * Shell aplikasi KCG Bridge (task 25.1) — layout + routing URL ala kcgrouter.
 *
 * Navigasi: `/` (daftar Project) -> `/projects/:projectId` (daftar Session)
 * -> `/projects/:projectId/sessions/:sessionId` (Session view).
 * - Rute halaman didaftarkan eksplisit di `src/index.ts` (`spaPaths`), lalu
 *   di sini `useRouter()` (pathname) + `parseRoute()` memilih halaman dari
 *   `src/pages/*` — tiap halaman me-resolve ulang datanya dari API sehingga
 *   refresh/direct link tetap berfungsi.
 * - `useTheme.ts` (dark mode) dipakai lewat `ThemeToggle` (Req 8.2, 8.6).
 * - Header memuat tombol token otentikasi (opsional, Req 9.2/9.3): token
 *   disimpan di `localStorage` dan dipakai `apiFetch` + `useWebSocket`.
 * - Halaman Session di-`key` per id agar remount saat pindah Session.
 */

import { KeyRoundIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRouter } from "@/hooks/useRouter";
import { getAuthToken, setAuthToken } from "@/lib/api";
import { parseRoute, projectsPath } from "@/lib/routes";
import { ProjectDetailPage } from "@/pages/projects/ProjectDetailPage";
import { ProjectsPage } from "@/pages/projects/ProjectsPage";
import { SessionPage } from "@/pages/sessions/SessionPage";

import logo from "../../logo.svg";

export function AppShell() {
  const { pathname, navigate } = useRouter();
  const route = parseRoute(pathname);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState(getAuthToken() ?? "");

  const saveToken = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthToken(token);
    setTokenOpen(false);
  };

  const isHome = route.name === "projects";
  /**
   * Session view punya header sendiri (back, nama model, play/stop, menu aksi
   * berisi tema & hapus), jadi chrome shell disembunyikan di sana — dua header
   * bertumpuk memakan tinggi layar HP tanpa menambah informasi.
   */
  const isSession = route.name === "session";

  return (
    <TooltipProvider>
      <div
        className={
          isHome
            ? "relative flex h-dvh w-full flex-col overflow-x-hidden bg-background"
            : "relative mx-auto flex h-dvh w-full max-w-5xl flex-col overflow-x-hidden bg-background shadow-sm sm:border-x"
        }
      >
        {/* Header (kecuali Session view yang membawa header sendiri) */}
        {!isSession && (
          <header
            className={
              isHome
                ? "mx-auto flex w-full max-w-xl shrink-0 justify-end px-4 py-3 sm:px-6"
                : "flex shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-6"
            }
          >
            {!isHome && (
              <a
                href={projectsPath()}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(projectsPath());
                }}
                className="flex min-w-0 items-center gap-2"
                aria-label="Back to projects"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary p-1.5 shadow-sm">
                  <img src={logo} alt="" className="size-full" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold leading-tight tracking-tight">
                    KCG Bridge
                  </span>
                  <span className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
                    Kontrol CLI_Agent dari mana saja
                  </span>
                </div>
              </a>
            )}
            <div className="flex shrink-0 items-center gap-1 rounded-full border bg-muted/40 p-0.5">
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
        )}

        {/* Input token (opsional, Requirement 9.2/9.3) */}
        {!isSession && tokenOpen && (
          <form
            onSubmit={saveToken}
            className="flex shrink-0 flex-col gap-2 border-b bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:px-6"
          >
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token otentikasi (kosongkan untuk menghapus)"
              aria-label="Token otentikasi"
              type="password"
              autoComplete="off"
              className="h-9 sm:h-8"
            />
            <Button type="submit" size="sm" className="w-full sm:w-auto">
              <SparklesIcon data-icon="inline-start" />
              Simpan token
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
          <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
            <div
              className={
                isHome
                  ? /* Homepage rata atas (bukan center): daftar Project adalah
                       fokus, jadi baris pertama langsung terlihat tanpa gap
                       atas besar — dan daftar yang lebih tinggi dari layar
                       tetap bisa di-scroll seluruhnya. */
                    "flex min-h-full flex-col px-4 py-6 sm:px-6 sm:py-10"
                  : "mx-auto w-full p-4 pb-12 sm:p-6 sm:pb-16 lg:p-8"
              }
            >
              {route.name === "projects" && <ProjectsPage />}
              {route.name === "project" && (
                <ProjectDetailPage key={route.projectId} projectId={route.projectId} />
              )}
              {route.name === "not-found" && <NotFoundView />}
            </div>
          </main>
        )}
      </div>
    </TooltipProvider>
  );
}

function NotFoundView() {
  const { navigate } = useRouter();
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
