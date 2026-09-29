/**
 * Sidebar aplikasi: seluruh Session digroup per Project (shadcn `sidebar`).
 *
 * - Desktop (>= md): panel tetap di kiri, bisa diciutkan (tombol trigger /
 *   Ctrl+B). Mobile: Sheet off-canvas yang otomatis tertutup setelah memilih
 *   Session agar layar penuh kembali untuk chat.
 * - Tiap Project = Collapsible berisi daftar Session (running di atas).
 *   Klik sekali = expand/collapse; dobel klik (mouse) = buka halaman Project.
 *   Layar sentuh & keyboard tidak punya dobel klik, jadi baris terakhir tiap
 *   Project selalu berupa tautan ke halaman Project ("Show all (n)" bila ada
 *   Session tersembunyi, selain itu "Project details").
 * - Navigasi utama di atas daftar: "New session" (homepage/composer chat),
 *   "Search" (command palette `SearchDialog`, juga Ctrl/⌘+K), dan "Skills"
 *   (`/skills`).
 * - Footer: toggle tema terang/gelap.
 */
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  MessageCirclePlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { SearchDialog } from "@/components/layout/SearchDialog";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useRouter } from "@/hooks/useRouter";
import type { UseSidebarDataResult } from "@/hooks/useSidebarData";
import { type AppRoute, projectPath, projectsPath, sessionPath, skillsPath } from "@/lib/routes";
import { SESSION_STATUS_DOT, SESSION_STATUS_LABEL } from "@/lib/session-status";
import { displaySessionTitle } from "@/lib/session-title";
import type { SidebarProjectGroup } from "@/lib/sidebar-groups";
import { cn } from "@/lib/utils";

import logo from "../../logo.svg";

/** Indentasi kiri tombol navigasi utama (New session / Search / Skills). */
const NAV_BUTTON_CLASS = "pl-4";

/** Batas Session per Project yang tampil sebelum tautan "Show all". */
const MAX_VISIBLE_SESSIONS = 5;

export interface AppSidebarProps {
  route: AppRoute;
  data: UseSidebarDataResult;
}

export function AppSidebar({ route, data }: AppSidebarProps) {
  const { navigate } = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);

  // Pintasan global Ctrl/⌘+K membuka pencarian.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Navigasi SPA dari tautan sidebar; Sheet mobile ditutup setelahnya. */
  const go = (path: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Biarkan ctrl/cmd/middle-click membuka tab baru seperti tautan biasa.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path);
    if (isMobile) setOpenMobile(false);
  };

  const activeProjectId =
    route.name === "project" || route.name === "session" ? route.projectId : null;
  const activeSessionId = route.name === "session" ? route.sessionId : null;

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href={projectsPath()} onClick={go(projectsPath())}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary p-1.5">
                  <img src={logo} alt="" className="size-full" />
                </span>
                <span className="truncate font-semibold">KCG Code</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Navigasi utama */}
        <SidebarMenu className="mt-1">
          <SidebarMenuItem>
            {/* Homepage = composer chat: kirim pesan di sana membuat Session
                baru di Project yang dipilih. */}
            <SidebarMenuButton
              asChild
              isActive={route.name === "projects"}
              className={NAV_BUTTON_CLASS}
            >
              <a href={projectsPath()} onClick={go(projectsPath())}>
                <MessageCirclePlusIcon />
                <span>New session</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                setSearchOpen(true);
              }}
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              className={NAV_BUTTON_CLASS}
            >
              <SearchIcon />
              <span>Search</span>
              <kbd className="ml-auto hidden rounded border bg-sidebar px-1.5 font-mono text-[10px] text-muted-foreground md:inline">
                Ctrl K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={route.name === "skills"}
              className={NAV_BUTTON_CLASS}
            >
              {/* Bawa Project aktif agar otomatis terpilih di halaman Skills. */}
              <a href={skillsPath(activeProjectId)} onClick={go(skillsPath(activeProjectId))}>
                <SparklesIcon />
                <span>Skills</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarBody
              data={data}
              activeProjectId={activeProjectId}
              activeSessionId={activeSessionId}
              go={go}
              navigate={(path) => {
                navigate(path);
                if (isMobile) setOpenMobile(false);
              }}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        groups={data.groups}
        onSelect={navigate}
      />
    </Sidebar>
  );
}

type GoHandler = (path: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
/** Navigasi langsung (tanpa event anchor) — dipakai dobel klik Project. */
type NavigateFn = (path: string) => void;

interface SidebarBodyProps {
  data: UseSidebarDataResult;
  activeProjectId: string | null;
  activeSessionId: string | null;
  go: GoHandler;
  navigate: NavigateFn;
}

/** Isi grup: skeleton, error, kosong, atau daftar Project. */
function SidebarBody({ data, activeProjectId, activeSessionId, go, navigate }: SidebarBodyProps) {
  if (data.initialLoading) {
    return (
      <SidebarMenu aria-busy="true" aria-label="Loading sessions">
        {["a", "b", "c", "d"].map((k) => (
          <SidebarMenuItem key={k}>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    );
  }

  if (data.loadError && data.projectCount === 0) {
    return (
      <div className="flex flex-col items-start gap-2 px-2 py-1 text-xs text-muted-foreground">
        <p role="alert">{data.loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void data.refresh()}>
          <RefreshCwIcon data-icon="inline-start" />
          Retry
        </Button>
      </div>
    );
  }

  if (data.projectCount === 0) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet.</p>;
  }

  return (
    <SidebarMenu>
      {data.groups.map((group) => (
        <ProjectGroup
          key={group.project.id}
          group={group}
          active={group.project.id === activeProjectId}
          activeSessionId={activeSessionId}
          go={go}
          navigate={navigate}
        />
      ))}
    </SidebarMenu>
  );
}

interface ProjectGroupProps {
  group: SidebarProjectGroup;
  /** Project sedang dibuka (halaman Project atau salah satu Session-nya). */
  active: boolean;
  activeSessionId: string | null;
  go: GoHandler;
  navigate: NavigateFn;
}

function ProjectGroup({ group, active, activeSessionId, go, navigate }: ProjectGroupProps) {
  const { isMobile } = useSidebar();
  const [open, setOpen] = useState(active || group.sessions.length > 0);
  /**
   * Jenis pointer klik terakhir. Dobel klik hanya berlaku untuk mouse —
   * double-tap di layar sentuh bisa ikut menghasilkan `detail === 2` dan
   * tidak boleh tiba-tiba berpindah halaman.
   */
  const pointerType = useRef<string>("mouse");
  const { project, sessions, runningCount } = group;
  const visible = sessions.slice(0, MAX_VISIBLE_SESSIONS);
  // Session aktif di luar potongan tetap ditampilkan agar posisi terlihat.
  const activeHidden =
    activeSessionId !== null &&
    !visible.some((s) => s.id === activeSessionId) &&
    sessions.find((s) => s.id === activeSessionId);
  const shown = activeHidden ? [...visible, activeHidden] : visible;
  const hiddenCount = sessions.length - shown.length;
  const detailPath = projectPath(project.id);

  /**
   * Klik pertama (detail 1) dibiarkan ke Collapsible = toggle. Klik kedua
   * dari dobel klik mouse (detail 2) membatalkan toggle-nya
   * (`preventDefault` dihormati Radix) lalu membuka halaman Project; grup
   * dipastikan terbuka agar Session-nya tetap terlihat.
   */
  const onProjectClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.detail >= 2 && pointerType.current === "mouse") {
      e.preventDefault();
      setOpen(true);
      navigate(detailPath);
    }
  };

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={active && activeSessionId === null}
            tooltip={project.name}
            aria-label={`${project.name}, ${sessions.length} sessions`}
            onPointerDown={(e) => {
              pointerType.current = e.pointerType;
            }}
            onClick={onProjectClick}
            // Petunjuk dobel klik hanya untuk pointer mouse (bukan HP).
            title={isMobile ? undefined : "Click to expand · Double-click to open project"}
            // Dobel klik tidak boleh ikut memblok (select) nama Project.
            className="select-none"
          >
            <ChevronRightIcon className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            {active ? <FolderOpenIcon /> : <FolderIcon />}
            <span>{project.name}</span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        {runningCount > 0 && (
          <SidebarMenuBadge aria-label={`${runningCount} running`}>{runningCount}</SidebarMenuBadge>
        )}

        <CollapsibleContent>
          <SidebarMenuSub>
            {shown.length === 0 && (
              <SidebarMenuSubItem>
                <span className="block px-2 py-1 text-xs text-muted-foreground">
                  No sessions yet
                </span>
              </SidebarMenuSubItem>
            )}
            {shown.map((session) => {
              const title = displaySessionTitle(session.title);
              const path = sessionPath(project.id, session.id);
              const isActive = session.id === activeSessionId;
              return (
                <SidebarMenuSubItem key={session.id}>
                  <SidebarMenuSubButton
                    href={path}
                    onClick={go(path)}
                    isActive={isActive}
                    aria-current={isActive ? "page" : undefined}
                    title={title}
                    // Target sentuh lebih tinggi di HP (h-7 default terlalu kecil).
                    className="h-9 md:h-7"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        SESSION_STATUS_DOT[session.status],
                      )}
                    />
                    <span className="sr-only">{SESSION_STATUS_LABEL[session.status]}:</span>
                    <span>{title}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
            {/* Selalu ada: jalan ke halaman Project untuk layar sentuh &
                keyboard (dobel klik hanya pintasan mouse). */}
            {/* Sengaja lebih ringan dari baris Session: teks 11px, tipis,
                redup, tanpa titik status — terbaca sebagai tautan sekunder.
                Tinggi sentuh tetap 32px di HP. */}
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                href={detailPath}
                onClick={go(detailPath)}
                size="sm"
                isActive={active && activeSessionId === null}
                aria-current={active && activeSessionId === null ? "page" : undefined}
                className="group/detail h-8 w-fit gap-0.5 pr-1.5 text-[11px] font-normal text-muted-foreground/80 hover:text-foreground data-[active=true]:font-medium data-[active=true]:text-foreground md:h-6 [&>svg]:size-3 [&>svg]:text-current"
              >
                <span>{hiddenCount > 0 ? `Show all ${sessions.length}` : "Project details"}</span>
                <ChevronRightIcon
                  className="transition-transform group-hover/detail:translate-x-0.5"
                  aria-hidden
                />
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
