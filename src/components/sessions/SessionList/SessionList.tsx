/**
 * Daftar & pembuatan Session milik sebuah Project (Requirement 1.1, 1.3, 1.5).
 *
 * Halaman detail Project — gaya libadwaita (GNOME Settings), sama dengan
 * panel samping: grup berjudul berisi "boxed list" (primitif `settings/prefs`).
 * - Header: nama Project besar, path (salin saat hover). Aksi: tombol pil
 *   "New session" + tombol bundar "..." Reload/Delete (`ProjectMenu`; hapus
 *   tetap lewat dialog konfirmasi). Desktop: di kanan judul. Layar sempit:
 *   "New session" jadi tombol melayang kanan-bawah (area jempol); toolbar di
 *   bawah judul berisi "Details" (panel samping) dan menu "...".
 * - Panel samping (`ProjectSidePanel`, gaya Claude Projects): custom
 *   instruction, MCP server, dan skill. Layar `lg`+ = kolom kanan sticky;
 *   lebih sempit = Sheet dari kanan lewat tombol di header.
 *   Tanpa tombol back — navigasi lewat sidebar.
 * - Daftar Session: satu grup "Sessions" berisi baris AdwActionRow, dengan
 *   dua tab (AdwToggleGroup): "KCG Code" (Session KCG, urut `sortSessions`:
 *   running -> crashed -> stopped, terbaru dulu) dan "Other agents" (Session
 *   Claude Desktop / CLI & OpenCode TUI / desktop untuk folder ini, terbaru
 *   dulu — `ExternalSessions.tsx`). Tab hanya muncul bila ada agent lain
 *   yang mendukungnya. Kolom cari menyaring tab aktif; tiap tab dipaginasi
 *   (`SESSION_PAGE_SIZE`). Keduanya kosong -> AdwStatusPage.
 * - `GET /api/sessions` di-filter per `projectId` (Requirement 1.5).
 *
 * File ini hanya menyusun area dari bagian yang sudah dipisah:
 * - State & aksi daftar: `hooks/useSessionList.ts`; akhir otomatis selection
 *   mode (Esc / daftar kosong): `useSelectionModeExit.ts`.
 * - Header (judul, path, menu "..."): `ProjectHeader.tsx`; empty state:
 *   `EmptySessions.tsx`; action bar selection mode: `SelectionActionBar.tsx`.
 * - Form pembuatan Session: `NewSessionDialog.tsx`.
 * - Satu baris Session: `SessionRow.tsx`; dialog konfirmasi hapus:
 *   `ConfirmSessionDeleteDialog.tsx` & `ConfirmDeleteProjectDialog.tsx`.
 */
import {
  ListChecksIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ProjectSidePanel } from "@/components/projects/ProjectSidePanel";
import { ConfirmDeleteProjectDialog } from "@/components/sessions/ConfirmDeleteProjectDialog";
import { ConfirmSessionDeleteDialog } from "@/components/sessions/ConfirmSessionDeleteDialog";
import {
  ExternalErrorRow,
  ExternalSessionRow,
  externalRowKey,
  useExternalSessions,
} from "@/components/sessions/ExternalSessions";
import { ListPager } from "@/components/sessions/ListPager";
import { NewSessionDialog } from "@/components/sessions/NewSessionDialog";
import { SessionListSkeleton, SessionRow } from "@/components/sessions/SessionRow";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
import { AdwToggleGroup } from "@/components/ui/adw-toggle-group";
import { Button } from "@/components/ui/button";
import { SearchEntry } from "@/components/ui/search-entry";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery, WIDE_QUERY } from "@/hooks/useMediaQuery";
import { useSessionList } from "@/hooks/useSessionList";
import { notifyDataChanged } from "@/lib/data-events";
import { describeExternalSummary } from "@/lib/external-sessions";
import { paginate, SESSION_PAGE_SIZE } from "@/lib/pagination";
import { searchExternalSessions, searchSessions } from "@/lib/session-search";
import { describeSelection } from "@/lib/session-selection";
import { describeSessionSummary } from "@/lib/session-summary";
import type { Project, Session } from "@/types";
import { EmptySessions } from "./EmptySessions";
import { ProjectHeader } from "./ProjectHeader";
import { SelectionActionBar } from "./SelectionActionBar";
import { useSelectionModeExit } from "./useSelectionModeExit";

type SessionTab = "kcg" | "other";

/** Label tab: nama + jumlah redup. */
function TabLabel({ name, count }: { name: string; count: number }) {
  return (
    <>
      {name} <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
    </>
  );
}

/** Baris pesan kosong di dalam boxed list (tab kosong / tidak ada hasil). */
function EmptyRow({ children }: { children: ReactNode }) {
  return <li className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</li>;
}

export interface SessionListProps {
  project: Project;
  onOpenSession: (session: Session) => void;
  /** Dipanggil setelah Project dihapus, untuk kembali ke daftar Project. */
  onDeleted?: () => void;
}

export function SessionList({
  project: initialProject,
  onOpenSession,
  onDeleted,
}: SessionListProps) {
  /** Salinan lokal agar perubahan (mis. instruksi) langsung tampil. */
  const [project, setProject] = useState(initialProject);
  useEffect(() => setProject(initialProject), [initialProject]);
  const list = useSessionList({ projectId: project.id, onDeleted });
  /** Form pembuatan Session — dialog, dibuka lewat tombol. */
  const [formOpen, setFormOpen] = useState(false);
  const openForm = () => setFormOpen(true);
  /** Naik tiap "Reload sessions" -> tab "Other agents" ikut dimuat ulang. */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => {
    void list.refresh();
    setReloadKey((n) => n + 1);
  };
  const external = useExternalSessions({
    projectId: project.id,
    reloadKey,
    onImported: (session) => {
      void list.refresh();
      notifyDataChanged();
      // Langsung dibuka — pesan berikutnya melanjutkan percakapannya.
      onOpenSession(session);
    },
  });

  // Tab "Other agents" hanya ada bila setidaknya satu agent mendukung impor.
  const otherAgents = external.load?.agents ?? [];
  const otherErrors = external.load?.errors ?? [];
  const otherSessions = external.load?.sessions ?? [];
  const [tabChoice, setTabChoice] = useState<SessionTab>("kcg");
  const tab: SessionTab = otherAgents.length > 0 ? tabChoice : "kcg";
  /** Search bar (tertutup = tanpa saring); kueri dipakai bersama kedua tab. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setPages({ kcg: 0, other: 0 });
  };
  /** Halaman tiap tab (dijepit oleh `paginate` bila daftar menyusut). */
  const [pages, setPages] = useState<Record<SessionTab, number>>({ kcg: 0, other: 0 });
  const kcgPage = paginate(searchSessions(list.ordered, query), pages.kcg, SESSION_PAGE_SIZE);
  const otherPage = paginate(
    searchExternalSessions(otherSessions, query),
    pages.other,
    SESSION_PAGE_SIZE,
  );
  const setPage = (page: number) => setPages((p) => ({ ...p, [tab]: page }));
  const switchTab = (next: SessionTab) => {
    setTabChoice(next);
    if (next === "other") list.stopSelecting();
  };

  const hasKcg = list.ordered.length > 0;
  const tabTotal = tab === "kcg" ? list.ordered.length : otherSessions.length;
  const tabPage = tab === "kcg" ? kcgPage : otherPage;
  /** Tidak ada apa pun untuk ditampilkan -> AdwStatusPage. */
  const nothing = !hasKcg && otherSessions.length === 0 && otherErrors.length === 0;
  const noMatch = `No session matches “${query.trim()}”.`;
  const allSelected =
    list.sessions.length > 0 && list.sessions.every((s) => list.selected.has(s.id));

  // Esc / daftar kosong mengakhiri selection mode.
  useSelectionModeExit(list);
  /** Layar lebar: panel samping inline. Sempit: panel di Sheet (tombol header). */
  const wide = useMediaQuery(WIDE_QUERY);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sidePanel = <ProjectSidePanel project={project} onProjectChange={setProject} />;

  return (
    // lg+: grid setinggi viewport; tiap kolom scroll sendiri (min-h-0).
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 pt-4 sm:pt-8 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-8 lg:min-h-0 lg:gap-0">
        {/* Header tetap di atas; hanya daftar Session yang scroll (lg+). */}
        <ProjectHeader
          project={project}
          wide={wide}
          loading={list.loading}
          onReload={reload}
          onDelete={list.openProjectDelete}
          onNewSession={openForm}
          onShowDetails={() => setDetailsOpen(true)}
        />

        <section
          aria-label="Sessions"
          // pb-24 (mobile): ruang agar baris terakhir tidak tertutup FAB.
          className="-mx-3 px-3 pb-24 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pb-16"
        >
          {list.loading ? (
            <SessionListSkeleton />
          ) : list.loadError ? (
            <PrefsGroup title="Sessions">
              <ActionRow
                prefix={<TriangleAlertIcon className="size-[18px] text-destructive" aria-hidden />}
                title="Failed to load sessions"
                subtitle={list.loadError}
                suffix={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void list.refresh()}
                  >
                    <RefreshCwIcon data-icon="inline-start" />
                    Retry
                  </Button>
                }
              />
            </PrefsGroup>
          ) : nothing ? (
            <EmptySessions projectName={project.name} onStart={openForm} />
          ) : (
            // Pembungkus: action bar sticky tetap menempel ke grup Sessions.
            <div>
              {/* AdwPreferencesGroup: ringkasan tab aktif sebagai deskripsi,
                  Session sebagai boxed list. Tombol "Select" (tab KCG Code)
                  masuk selection mode (pola Nautilus/Contacts) untuk hapus
                  massal. */}
              <PrefsGroup
                title="Sessions"
                description={
                  tab === "other"
                    ? describeExternalSummary(otherSessions)
                    : list.selecting
                      ? describeSelection(list.selected.size, list.sessions.length)
                      : describeSessionSummary(list.summary)
                }
                suffix={
                  // Header bar ala GNOME: tombol cari (membuka search bar) +
                  // Select (hanya tab KCG Code).
                  <div className="flex items-center gap-1">
                    {tabTotal > 0 && !list.selecting && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full"
                        aria-label="Search sessions"
                        aria-pressed={searchOpen}
                        onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                      >
                        <SearchIcon />
                      </Button>
                    )}
                    {tab === "kcg" &&
                      hasKcg &&
                      (list.selecting ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={list.toggleSelectAll}
                          disabled={list.bulkProgress !== null}
                        >
                          {allSelected ? "Deselect All" : "Select All"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={list.startSelecting}
                          aria-label="Select sessions"
                        >
                          <ListChecksIcon data-icon="inline-start" />
                          Select
                        </Button>
                      ))}
                  </div>
                }
                toolbar={
                  (otherAgents.length > 0 || (searchOpen && tabTotal > 0)) && (
                    <div className="flex flex-col gap-3 pt-1 pb-1.5">
                      {otherAgents.length > 0 && (
                        <AdwToggleGroup<SessionTab>
                          label="Session source"
                          value={tab}
                          onChange={switchTab}
                          disabled={list.selecting}
                          className="sm:w-80"
                          options={[
                            {
                              value: "kcg",
                              label: <TabLabel name="KCG Code" count={list.ordered.length} />,
                              ariaLabel: `KCG Code, ${list.ordered.length} sessions`,
                            },
                            {
                              value: "other",
                              label: <TabLabel name="Other agents" count={otherSessions.length} />,
                              ariaLabel: `Other agents, ${otherSessions.length} sessions`,
                            },
                          ]}
                        />
                      )}
                      {/* GtkSearchBar: muncul lewat tombol cari; Esc saat
                          kosong menutupnya. */}
                      {searchOpen && tabTotal > 0 && (
                        <SearchEntry
                          autoFocus
                          value={query}
                          onValueChange={(v) => {
                            setQuery(v);
                            setPages({ kcg: 0, other: 0 });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape" && query === "") {
                              e.preventDefault();
                              closeSearch();
                            }
                          }}
                          placeholder={`Search ${tabTotal} sessions…`}
                          aria-label={
                            tab === "kcg" ? "Search sessions" : "Search other agents' sessions"
                          }
                        />
                      )}
                    </div>
                  )
                }
                footer={
                  <ListPager
                    page={tabPage}
                    label={tab === "kcg" ? "sessions" : "other agents' sessions"}
                    onPageChange={setPage}
                  />
                }
              >
                {tab === "kcg" ? (
                  !hasKcg ? (
                    <EmptyRow>No sessions yet. Start one with New session.</EmptyRow>
                  ) : kcgPage.total === 0 ? (
                    <EmptyRow>{noMatch}</EmptyRow>
                  ) : (
                    kcgPage.items.map((session) => (
                      <li key={session.id}>
                        <SessionRow
                          session={session}
                          busy={
                            list.stopping === session.id ||
                            list.starting === session.id ||
                            list.deleting === session.id
                          }
                          onOpen={() => onOpenSession(session)}
                          onStop={() => void list.stop(session.id)}
                          onStart={() => void list.start(session.id)}
                          onDelete={() => list.requestDelete(session)}
                          selectionMode={list.selecting}
                          selected={list.selected.has(session.id)}
                          onToggleSelect={() => list.toggleSelect(session.id)}
                        />
                      </li>
                    ))
                  )
                ) : (
                  <>
                    {otherSessions.length === 0 && otherErrors.length === 0 ? (
                      <EmptyRow>No sessions from other agents in this folder.</EmptyRow>
                    ) : otherSessions.length > 0 && otherPage.total === 0 ? (
                      <EmptyRow>{noMatch}</EmptyRow>
                    ) : (
                      otherPage.items.map((s) => (
                        <li key={externalRowKey(s)}>
                          <ExternalSessionRow
                            session={s}
                            pending={external.pendingKey === externalRowKey(s)}
                            disabled={external.pendingKey !== null}
                            onSelect={() => void external.runImport(s)}
                          />
                        </li>
                      ))
                    )}
                    {otherErrors.map((err) => (
                      <li key={`error:${err.agentType}`}>
                        <ExternalErrorRow
                          agentType={err.agentType}
                          message={err.message}
                          onRetry={external.reload}
                        />
                      </li>
                    ))}
                  </>
                )}
              </PrefsGroup>

              {/* Action bar selection mode (GtkActionBar): melayang di dasar
                  area scroll — jumlah terpilih, Cancel, Delete (destruktif). */}
              {list.selecting && (
                <SelectionActionBar
                  count={list.selected.size}
                  busy={list.bulkProgress !== null}
                  onCancel={list.stopSelecting}
                  onDelete={list.requestBulkDelete}
                />
              )}
            </div>
          )}
        </section>
      </div>

      {/* Panel samping: Instructions, MCP, Skills (gaya Claude Projects). */}
      {wide ? (
        <aside
          aria-label="Project details"
          // Panel mandiri: padding sama di keempat sisi; scrollbar-gutter
          // stable di kedua tepi agar scrollbar tidak menggeser isi ke kiri.
          // Tanpa kotak pembungkus: tiap seksi sudah berupa kartu sendiri.
          // Scroll mandiri; pr kecil agar scrollbar tidak menempel ke kartu.
          className="-mr-2 min-h-0 overflow-y-auto overscroll-contain pr-2 pb-6 [scrollbar-width:thin]"
        >
          {sidePanel}
        </aside>
      ) : (
        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent side="right" className="w-[88vw] gap-0 overflow-y-auto sm:max-w-sm">
            <SheetHeader className="pb-2">
              <SheetTitle>{project.name}</SheetTitle>
              <SheetDescription>Instructions, MCP servers, and skills.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pt-2 pb-6">{sidePanel}</div>
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile/tablet: aksi utama melayang di kanan-bawah (jangkauan jempol,
          selalu terlihat saat scroll). Label teks tetap ada agar jelas —
          bukan ikon "+" tanpa arti. Safe-area iOS dihormati. */}
      {/* Disembunyikan saat selection mode: tempatnya dipakai action bar. */}
      {!wide && !list.selecting && (
        <Button
          type="button"
          onClick={openForm}
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-12 rounded-full px-5 text-[15px] shadow-lg shadow-primary/25 sm:right-6 sm:bottom-6"
        >
          <PlusIcon data-icon="inline-start" className="size-5" />
          New session
        </Button>
      )}

      {/* Form pembuatan Session — dialog agar daftar tidak terdorong di HP */}
      <NewSessionDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={project.id}
        projectName={project.name}
        onCreated={(session) => {
          void list.refresh();
          notifyDataChanged();
          // Session baru langsung dibuka — siap menerima prompt pertama.
          onOpenSession(session);
        }}
      />

      {/* Konfirmasi hapus Session permanen */}
      <ConfirmSessionDeleteDialog
        open={list.pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) list.cancelDelete();
        }}
        deleting={list.deleting !== null}
        onConfirm={() => void list.confirmRemove()}
      />

      {/* Konfirmasi hapus massal (selection mode) — progres di tombol. */}
      <ConfirmSessionDeleteDialog
        open={list.bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open) list.cancelBulkDelete();
        }}
        count={list.selected.size}
        deleting={list.bulkProgress !== null}
        progress={list.bulkProgress}
        onConfirm={() => void list.confirmBulkRemove()}
      />

      {/* Konfirmasi hapus Project (beserta seluruh Session-nya) */}
      <ConfirmDeleteProjectDialog
        open={list.projectDeleteOpen}
        onOpenChange={(open) => (open ? list.openProjectDelete() : list.closeProjectDelete())}
        projectName={project.name}
        sessionTotal={list.summary.total}
        deleting={list.deletingProject}
        onConfirm={() => void list.confirmRemoveProject()}
      />
    </div>
  );
}
