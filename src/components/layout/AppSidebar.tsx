/**
 * Sidebar aplikasi: seluruh Session digroup per Project (shadcn `sidebar`).
 *
 * - Desktop (>= md): panel tetap di kiri, bisa diciutkan (tombol trigger /
 *   Ctrl+B). Mobile: Sheet off-canvas yang otomatis tertutup setelah memilih
 *   Session agar layar penuh kembali untuk chat.
 * - Tiap Project = Collapsible berisi daftar Session (running di atas).
 *   Hanya `MAX_VISIBLE_SESSIONS` pertama yang tampil; sisanya lewat tautan
 *   "Show all" ke halaman Project.
 * - Tombol "New Session" di atas daftar membuka homepage (composer chat).
 */
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  RefreshCwIcon,
  SquarePenIcon,
} from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
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
import { type AppRoute, projectPath, projectsPath, sessionPath } from "@/lib/routes";
import { SESSION_STATUS_DOT, SESSION_STATUS_LABEL } from "@/lib/session-status";
import { displaySessionTitle } from "@/lib/session-title";
import type { SidebarProjectGroup } from "@/lib/sidebar-groups";
import { cn } from "@/lib/utils";

import logo from "../../logo.svg";

/** Batas Session per Project yang tampil sebelum tautan "Show all". */
const MAX_VISIBLE_SESSIONS = 5;

export interface AppSidebarProps {
  route: AppRoute;
  data: UseSidebarDataResult;
}

export function AppSidebar({ route, data }: AppSidebarProps) {
  const { navigate } = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();

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
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-semibold">KCG Code</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Control CLI_Agent from anywhere
                  </span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarInput
          type="search"
          value={data.query}
          onChange={(e) => data.setQuery(e.target.value)}
          placeholder="Search sessions…"
          aria-label="Search projects and sessions"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                {/* Homepage = composer chat: kirim pesan di sana membuat Session
                    baru di Project yang dipilih. */}
                <SidebarMenuButton asChild isActive={route.name === "projects"}>
                  <a href={projectsPath()} onClick={go(projectsPath())}>
                    <SquarePenIcon />
                    <span>New Session</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sessions by project</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarBody
              data={data}
              activeProjectId={activeProjectId}
              activeSessionId={activeSessionId}
              go={go}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

type GoHandler = (path: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;

interface SidebarBodyProps {
  data: UseSidebarDataResult;
  activeProjectId: string | null;
  activeSessionId: string | null;
  go: GoHandler;
}

/** Isi grup: skeleton, error, kosong, atau daftar Project. */
function SidebarBody({ data, activeProjectId, activeSessionId, go }: SidebarBodyProps) {
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

  if (data.groups.length === 0) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">
        No matches for “{data.query.trim()}”.
      </p>
    );
  }

  return (
    <SidebarMenu>
      {data.groups.map((group) => (
        <ProjectGroup
          // Remount saat query berubah agar hasil pencarian selalu terbuka.
          key={`${group.project.id}:${data.query.trim() !== ""}`}
          group={group}
          active={group.project.id === activeProjectId}
          activeSessionId={activeSessionId}
          forceOpen={data.query.trim() !== ""}
          go={go}
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
  forceOpen: boolean;
  go: GoHandler;
}

function ProjectGroup({ group, active, activeSessionId, forceOpen, go }: ProjectGroupProps) {
  const { project, sessions, runningCount } = group;
  const visible = sessions.slice(0, MAX_VISIBLE_SESSIONS);
  // Session aktif di luar potongan tetap ditampilkan agar posisi terlihat.
  const activeHidden =
    activeSessionId !== null &&
    !visible.some((s) => s.id === activeSessionId) &&
    sessions.find((s) => s.id === activeSessionId);
  const shown = activeHidden ? [...visible, activeHidden] : visible;
  const hiddenCount = sessions.length - shown.length;

  return (
    <Collapsible
      asChild
      defaultOpen={forceOpen || active || sessions.length > 0}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={active && activeSessionId === null}
            tooltip={project.name}
            aria-label={`${project.name}, ${sessions.length} sessions`}
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
            {hiddenCount > 0 && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton
                  href={projectPath(project.id)}
                  onClick={go(projectPath(project.id))}
                  size="sm"
                  className="h-8 text-muted-foreground md:h-7"
                >
                  <span>Show all ({sessions.length})</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
