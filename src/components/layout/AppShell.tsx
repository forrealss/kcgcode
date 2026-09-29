/**
 * Shell aplikasi KCG Code (task 25.1) — layout + routing URL ala kcgcode.
 *
 * Navigasi: `/` (daftar Project) -> `/projects/:projectId` (daftar Session)
 * -> `/projects/:projectId/sessions/:sessionId` (Session view).
 * - Rute halaman didaftarkan eksplisit di `src/index.ts` (`spaPaths`), lalu
 *   di sini `useRouter()` (pathname) + `parseRoute()` memilih halaman dari
 *   `src/pages/*` — tiap halaman me-resolve ulang datanya dari API sehingga
 *   refresh/direct link tetap berfungsi.
 * - Toggle tema (`ThemeToggle`, Req 8.2/8.6) ada di footer `AppSidebar`.
 * - Halaman Session di-`key` per id agar remount saat pindah Session.
 * - `AppSidebar` (shadcn `sidebar`) menampilkan seluruh Session digroup per
 *   Project: panel tetap di desktop, Sheet off-canvas di HP (`SidebarTrigger`
 *   di header shell & header Session).
 */

import { AppSidebar } from "@/components/layout/AppSidebar";
import { InstallNotifications } from "@/components/skills/InstallNotifications";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRouter } from "@/hooks/useRouter";
import { useSidebarData } from "@/hooks/useSidebarData";
import { parseRoute, projectsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { ProjectDetailPage } from "@/pages/projects/ProjectDetailPage";
import { ProjectsPage } from "@/pages/projects/ProjectsPage";
import { SessionPage } from "@/pages/sessions/SessionPage";
import { SkillsPage } from "@/pages/skills/SkillsPage";

import logo from "../../logo.svg";

export function AppShell() {
  const { pathname } = useRouter();
  const route = parseRoute(pathname);
  const sidebarData = useSidebarData(pathname);

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
              </header>
            )}

            {/* Konten per URL */}
            {route.name === "session" ? (
              <SessionPage
                key={`${route.projectId}/${route.sessionId}`}
                projectId={route.projectId}
                sessionId={route.sessionId}
              />
            ) : (
              <main
                className={cn(
                  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background",
                  // Detail Project lg+: kolom-kolomnya yang scroll, bukan <main>.
                  route.name === "project" && "lg:overflow-y-hidden",
                )}
              >
                <div
                  className={
                    isHome
                      ? /* Homepage rata atas (bukan center): daftar Project adalah
                       fokus, jadi baris pertama langsung terlihat tanpa gap
                       atas besar — dan daftar yang lebih tinggi dari layar
                       tetap bisa di-scroll seluruhnya. */
                        "flex min-h-full flex-col px-4 py-6 sm:px-6 sm:py-10"
                      : route.name === "project"
                        ? /* Detail Project: dua kolom (Session + panel samping).
                             Layar lg+: tinggi dikunci ke viewport (`h-full`),
                             tiap kolom scroll sendiri; lebih sempit: halaman
                             scroll biasa (panel samping ada di Sheet). */
                          "mx-auto w-full max-w-6xl px-4 pt-2 pb-12 sm:px-6 sm:pt-4 sm:pb-16 lg:h-full lg:pb-0"
                        : route.name === "skills"
                          ? /* Skills: grid kartu 2 kolom butuh ruang lebih lebar. */
                            "mx-auto w-full max-w-5xl px-4 pt-2 pb-12 sm:px-6 sm:pt-4 sm:pb-16"
                          : "mx-auto w-full max-w-3xl px-4 pt-2 pb-12 sm:px-6 sm:pt-4 sm:pb-16"
                  }
                >
                  {route.name === "projects" && <ProjectsPage />}
                  {route.name === "project" && (
                    <ProjectDetailPage key={route.projectId} projectId={route.projectId} />
                  )}
                  {route.name === "skills" && <SkillsPage />}
                  {route.name === "not-found" && <NotFoundView />}
                </div>
              </main>
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
      {/* Notifikasi instalasi skill: global agar tetap tampil di halaman mana pun. */}
      <InstallNotifications />
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
