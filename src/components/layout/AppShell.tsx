/**
 * Shell aplikasi KCG Code (task 25.1) — layout + routing URL ala kcgcode.
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
 * - `AppSidebar` (shadcn `sidebar`) menampilkan seluruh Session digroup per
 *   Project: panel tetap di desktop, Sheet off-canvas di HP (`SidebarTrigger`
 *   di header shell & header Session).
 */

import { KeyRoundIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRouter } from "@/hooks/useRouter";
import { useSidebarData } from "@/hooks/useSidebarData";
import { getAuthToken, setAuthToken } from "@/lib/api";
import { parseRoute, projectsPath } from "@/lib/routes";
import { ProjectDetailPage } from "@/pages/projects/ProjectDetailPage";
import { ProjectsPage } from "@/pages/projects/ProjectsPage";
import { SessionPage } from "@/pages/sessions/SessionPage";

import logo from "../../logo.svg";

export function AppShell() {
  const { pathname } = useRouter();
  const route = parseRoute(pathname);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState(getAuthToken() ?? "");
  const sidebarData = useSidebarData(pathname);

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
      <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
        <AppSidebar route={route} data={sidebarData} />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          {/* Area konten memenuhi SidebarInset — sidebar sudah jadi pembatas
              kiri, jadi tak perlu lagi kolom ber-border di tengah layar. Lebar
              baca dibatasi per halaman (lihat `<main>` di bawah). */}
          <div className="relative flex h-full w-full flex-col overflow-x-hidden bg-background">
            {/* Header (kecuali Session view yang membawa header sendiri) */}
            {!isSession && (
              <header className="flex w-full shrink-0 items-center gap-3 px-3 py-3 sm:px-4">
                <SidebarTrigger className="size-9 shrink-0" />
                {/* Brand hanya di HP — di desktop sudah ada di header sidebar. */}
                <span className="flex min-w-0 items-center gap-2 md:hidden">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary p-1">
                    <img src={logo} alt="" className="size-full" />
                  </span>
                  <span className="truncate text-sm font-semibold tracking-tight">KCG Code</span>
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-1 rounded-full border bg-muted/40 p-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setTokenOpen((o) => !o)}
                    aria-label="Authentication token settings"
                    title="Auth token"
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
                  placeholder="Auth token (leave empty to remove)"
                  aria-label="Auth token"
                  type="password"
                  autoComplete="off"
                  className="h-9 sm:h-8"
                />
                <Button type="submit" size="sm" className="w-full sm:w-auto">
                  <SparklesIcon data-icon="inline-start" />
                  Save token
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
                      : "mx-auto w-full max-w-3xl px-4 pt-2 pb-12 sm:px-6 sm:pt-4 sm:pb-16"
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
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function NotFoundView() {
  const { navigate } = useRouter();
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">Page not found.</p>
      <a
        href={projectsPath()}
        onClick={(e) => {
          e.preventDefault();
          navigate(projectsPath());
        }}
        className="text-sm font-medium underline underline-offset-4"
      >
        Back to projects
      </a>
    </div>
  );
}
