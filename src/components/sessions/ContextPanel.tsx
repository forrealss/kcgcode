/**
 * Kartu konteks Session — keadaan kerja agent, sebagai kolom di kanan
 * percakapan (desktop). Kolom ini ikut tata letak: chat menyempit saat kartu
 * dibuka, sehingga pesan & input tidak pernah tertutup kartu.
 *
 * Susunan (dari yang paling sering dilirik ke yang paling jarang):
 * - **Context window** : pemakaian context window (meter + rincian kategori)
 *                     dan tombol compact (`/compact`) beserta status
 *                     "Compacting…" selama agent meringkas riwayat.
 * - **Environment** : perubahan file (+/-), cabang git, status push/pull.
 * - **Task list**   : `todowrite` agent + progres "selesai / total".
 * - **MCP**         : server MCP; ringkasan "x/y connected" di judul. Yang
 *                     gagal & tersambung tampil per baris; yang perlu login
 *                     (mis. puluhan konektor claude.ai) dan yang tidak aktif
 *                     DILIPAT jadi satu baris "N need sign-in" agar tidak
 *                     menenggelamkan bagian lain.
 * - **Reference**   : file project yang DIBACA agent (bukan yang ditulis),
 *                     terbaru di atas; 8 pertama tampil, sisanya "Show N more".
 *
 * Pola UX (gaya libadwaita):
 * - Tiap bagian = judul yang bisa dilipat + ringkasan di kanan judul, isi
 *   berupa "boxed list" (kartu membulat, baris berpemisah) di atas latar
 *   kartu yang lebih gelap — seperti AdwPreferencesGroup.
 * - Status diwakili titik berwarna + label, bukan warna saja (a11y).
 * - Buka/tutup: `ContextPanelTrigger` (hamburger) HILANG saat kartu terbuka;
 *   penutupnya tombol X di kartu. Esc juga menutup.
 * - Mobile: isi yang sama tampil sebagai bottom sheet (`ContextSheet`).
 *
 * Selain tombol compact, kartu ini hanya informasi (belum ada aksi git):
 * barisnya tidak dibuat seperti tombol supaya tidak menyiratkan aksi yang
 * belum ada.
 */
import {
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  FileDiffIcon,
  FileTextIcon,
  FoldVerticalIcon,
  GaugeIcon,
  GitBranchIcon,
  LoaderIcon,
  MenuIcon,
  PlugIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import * as m from "motion/react-m";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatTokens, usageLevel } from "@/lib/context-usage";
import { MCP_STATUS_DOT, MCP_STATUS_LABEL } from "@/lib/project-extensions";
import { baseName, type FileReference } from "@/lib/references";
import { cn } from "@/lib/utils";
import type { ContextUsage, McpServerState, SessionContext, TodoItem } from "@/types";

// ----------------------------------------------------------- trigger ----

/** Tombol pembuka kartu — hanya dirender saat kartu tertutup. */
export function ContextPanelTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onOpen}
      aria-label="Show session context"
      title="Show context"
      aria-expanded={false}
      className="absolute end-3 top-2 z-30 size-9 rounded-full bg-background/80 shadow-sm backdrop-blur-sm sm:end-4"
    >
      <MenuIcon />
    </Button>
  );
}

// -------------------------------------------------------------- card ----

export interface ContextPanelProps {
  context: SessionContext | null;
  references: FileReference[];
  loading: boolean;
  onClose: () => void;
  /** Ringkas riwayat Session (`/compact`); tanpa nilai = tombol tidak tampil. */
  onCompact?: () => void;
  /** Compact boleh dijalankan sekarang (Session aktif, model tidak sedang merespon). */
  canCompact?: boolean;
  /** Agent sedang compact (WS — lebih segar daripada `context.compacting`). */
  compacting?: boolean;
}

/**
 * Isi kartu (keempat bagian) — dipakai bersama oleh kartu desktop
 * (`ContextPanel`) dan bottom sheet mobile (`ContextSheet`), jadi tampilan &
 * perilakunya selalu identik.
 */
function ContextSections({
  context,
  references,
  loading,
  onCompact,
  canCompact = false,
  compacting = false,
  /** Cadangkan ruang tombol X di judul bagian pertama (kartu desktop). */
  reserveClose = false,
}: Omit<ContextPanelProps, "onClose"> & { reserveClose?: boolean }) {
  if (loading && context === null) return <CardSkeleton />;
  return (
    <div className={cn("flex flex-col gap-4", reserveClose && "[&>*:first-child>button]:pe-7")}>
      <UsageSection
        usage={context?.usage ?? null}
        live={context?.live ?? false}
        compacting={compacting || (context?.compacting ?? false)}
        onCompact={onCompact}
        canCompact={canCompact}
      />
      <EnvironmentSection context={context} />
      <TaskSection todos={context?.todos ?? []} live={context?.live ?? false} />
      <McpSection servers={context?.mcp ?? []} live={context?.live ?? false} />
      <ReferenceSection references={references} />
    </div>
  );
}

/** Kartu desktop: kolom kanan, berdampingan dengan percakapan. */
export function ContextPanel({ onClose, ...props }: ContextPanelProps) {
  // Esc menutup kartu (pola sama dengan popover/sheet aplikasi).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <m.aside
      aria-label="Session context"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", visualDuration: 0.25, bounce: 0.1 }}
      // Latar kartu = latar jendela (lebih gelap), boxed list di atasnya
      // memakai `bg-card` — kontras ala AdwPreferencesPage.
      className="relative flex max-h-full flex-col overflow-hidden rounded-2xl border bg-background shadow-xs"
    >
      {/* Tanpa judul kartu: judul tiap bagian sudah menjadi penanda. Tombol
          tutup mengapung di pojok kanan atas, sejajar judul bagian pertama. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Hide session context"
        title="Hide context (Esc)"
        className="absolute end-1.5 top-1.5 z-10 size-6 rounded-full [&_svg]:size-3.5"
      >
        <XIcon />
      </Button>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pt-2 pb-3 [scrollbar-width:thin]">
        <ContextSections {...props} reserveClose />
      </div>
    </m.aside>
  );
}

/**
 * Bottom sheet mobile: isi sama dengan kartu desktop. Sheet sudah menangani
 * overlay, drag handle, Esc, tap di luar, dan focus trap — jadi tidak perlu
 * tombol X (pola sama dengan sheet aksi composer).
 */
export function ContextSheet({
  open,
  onOpenChange,
  ...props
}: Omit<ContextPanelProps, "onClose"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[80dvh] gap-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Session context</SheetTitle>
          <SheetDescription>
            Context window, environment, MCP servers, task list, and files read by the agent.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pt-2 pb-1">
          <ContextSections {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ----------------------------------------------------------- sections ----

/** Warna isi meter per tingkat pemakaian (AdwLevelBar low/high/full). */
const LEVEL_FILL = {
  normal: "bg-primary",
  warning: "bg-amber-500",
  critical: "bg-destructive",
} as const;

/** Batas kategori rincian yang ditampilkan (terbesar dulu). */
const MAX_CATEGORIES = 4;

function UsageSection({
  usage,
  live,
  compacting,
  onCompact,
  canCompact,
}: {
  usage: ContextUsage | null;
  live: boolean;
  compacting: boolean;
  onCompact?: () => void;
  canCompact: boolean;
}) {
  const summary =
    usage === null
      ? undefined
      : usage.percent !== null
        ? `${usage.percent}%`
        : `${formatTokens(usage.usedTokens)} tokens`;
  const compactRow = onCompact && (
    <li className="px-2.5 py-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onCompact}
        disabled={!canCompact || compacting}
        title="Summarize the conversation so far to free up context (/compact)"
        className="h-8 w-full rounded-lg text-[12.5px]"
      >
        {compacting ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <FoldVerticalIcon data-icon="inline-start" />
        )}
        {compacting ? "Compacting…" : "Compact conversation"}
      </Button>
    </li>
  );

  return (
    <Section title="Context window" summary={summary}>
      {usage === null ? (
        <Box>
          <Row
            icon={<GaugeIcon />}
            label={
              compacting
                ? "Compacting the conversation…"
                : live
                  ? "Measured after the agent replies"
                  : "Start the session to see usage"
            }
            muted
          />
          {compactRow}
        </Box>
      ) : (
        <Box>
          <UsageMeter usage={usage} />
          {usage.categories.slice(0, MAX_CATEGORIES).map((c) => (
            <Row
              key={c.name}
              icon={<CircleIcon className="!size-2 fill-current" />}
              label={c.name}
              muted
              value={
                <span className="text-[11.5px] text-muted-foreground tabular-nums">
                  {formatTokens(c.tokens)}
                </span>
              }
            />
          ))}
          {compactRow}
        </Box>
      )}
    </Section>
  );
}

/**
 * Meter pemakaian (AdwLevelBar): token terpakai / ukuran window, model, dan
 * garis penanda ambang auto-compact bila diketahui.
 */
function UsageMeter({ usage }: { usage: ContextUsage }) {
  const level = usageLevel(usage.percent);
  const fill = Math.min(100, usage.percent ?? 0);
  const autoAt =
    usage.autoCompactAt !== null && usage.maxTokens
      ? Math.min(100, (usage.autoCompactAt / usage.maxTokens) * 100)
      : null;
  return (
    <li className="flex flex-col gap-1.5 px-2.5 py-2 text-[12.5px]">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate tabular-nums">
          {formatTokens(usage.usedTokens)}
          {usage.maxTokens !== null && (
            <span className="text-muted-foreground">
              {" "}
              of {formatTokens(usage.maxTokens)} tokens
            </span>
          )}
        </span>
        {usage.model && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {usage.model}
          </span>
        )}
      </div>
      {usage.percent !== null && (
        // biome-ignore lint/a11y/useSemanticElements: <meter> native sulit diberi gaya AdwLevelBar lintas browser.
        <div
          role="meter"
          aria-label="Context window usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={fill}
          aria-valuetext={`${usage.percent}% used`}
          className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10"
        >
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300",
              LEVEL_FILL[level],
            )}
            style={{ width: `${fill}%` }}
          />
          {autoAt !== null && (
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-foreground/50"
              style={{ left: `${autoAt}%` }}
            />
          )}
        </div>
      )}
      {usage.autoCompactAt !== null && (
        <span className="text-[11px] text-muted-foreground">
          Auto-compacts at {formatTokens(usage.autoCompactAt)}
        </span>
      )}
    </li>
  );
}

function EnvironmentSection({ context }: { context: SessionContext | null }) {
  const changed = context?.changes ?? [];
  const added = changed.reduce((n, c) => n + c.added, 0);
  const removed = changed.reduce((n, c) => n + c.removed, 0);
  const git = context?.git;

  return (
    <Section title="Environment">
      <Box>
        <Row
          icon={<FileDiffIcon />}
          label={
            changed.length === 0
              ? "No changes"
              : `${changed.length} ${changed.length === 1 ? "file" : "files"} changed`
          }
          value={changed.length > 0 ? <DiffStat added={added} removed={removed} /> : undefined}
        />
        <Row
          icon={<GitBranchIcon />}
          label={git?.branch ?? "Not a git repository"}
          muted={!git?.branch}
          mono={Boolean(git?.branch)}
        />
        {git?.branch && (
          <Row
            icon={<UploadIcon />}
            label={syncLabel(git.ahead, git.behind, git.hasRemote)}
            muted
          />
        )}
      </Box>
    </Section>
  );
}

/** Status yang "perlu login" — dilipat jadi satu baris bila lebih dari satu. */
const NEEDS_SIGN_IN: McpServerState["status"][] = ["needs_auth", "needs_client_registration"];

function McpSection({ servers, live }: { servers: McpServerState[]; live: boolean }) {
  const connected = servers.filter((s) => s.status === "connected").length;
  const failed = servers.filter((s) => s.status === "failed").length;
  const byName = (a: McpServerState, b: McpServerState) => a.name.localeCompare(b.name);
  const signIn = servers.filter((s) => NEEDS_SIGN_IN.includes(s.status)).sort(byName);
  const inactive = servers
    .filter((s) => s.status === "disabled" || s.status === "unknown")
    .sort(byName);
  // Baris individual: gagal (paling atas) lalu tersambung. Kelompok berisi
  // satu server tetap tampil sebagai baris biasa (tidak perlu dilipat).
  const individual = [
    ...servers.filter((s) => s.status === "failed").sort(byName),
    ...servers.filter((s) => s.status === "connected").sort(byName),
    ...(signIn.length === 1 ? signIn : []),
    ...(inactive.length === 1 ? inactive : []),
  ];

  return (
    <Section
      title="MCP"
      summary={
        servers.length > 0 ? (
          // Hanya kegagalan yang diberi warna peringatan — konektor yang
          // belum login itu normal, bukan masalah.
          <span className={cn(failed > 0 && "text-amber-700 dark:text-amber-400")}>
            {connected}/{servers.length} connected
          </span>
        ) : undefined
      }
    >
      {servers.length === 0 ? (
        <Empty>{live ? "No MCP servers configured" : "Start the session to see MCP servers"}</Empty>
      ) : (
        <Box>
          {individual.map((server) => (
            <McpRow key={server.name} server={server} />
          ))}
          {signIn.length > 1 && (
            <McpGroupRow
              label={`${signIn.length} need sign-in`}
              dotClass={MCP_STATUS_DOT.needs_auth}
              servers={signIn}
            />
          )}
          {inactive.length > 1 && (
            <McpGroupRow
              label={`${inactive.length} inactive`}
              dotClass={MCP_STATUS_DOT.disabled}
              servers={inactive}
            />
          )}
        </Box>
      )}
    </Section>
  );
}

/** Satu server MCP: nama + status (titik + label); error di baris kedua. */
function McpRow({ server }: { server: McpServerState }) {
  return (
    <Row
      icon={<PlugIcon />}
      label={server.name}
      hint={server.error ?? undefined}
      hintTone={server.error ? "error" : undefined}
      // Pesan error lengkap terbaca lewat `title` (baris kedua terpotong).
      title={server.error ?? undefined}
      value={<StatusText status={server.status} />}
    />
  );
}

function StatusText({ status }: { status: McpServerState["status"] }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span aria-hidden className={cn("size-1.5 rounded-full", MCP_STATUS_DOT[status])} />
      {MCP_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Baris kelompok yang bisa dibuka (AdwExpanderRow): "17 need sign-in" —
 * isinya nama server, tanpa status berulang (sudah di judul baris).
 */
function McpGroupRow({
  label,
  dotClass,
  servers,
}: {
  label: string;
  dotClass: string;
  servers: McpServerState[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-9 w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
          <span className={cn("size-1.5 rounded-full", dotClass)} />
        </span>
        <span className="min-w-0 flex-1 truncate leading-5 text-muted-foreground">{label}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul className="border-t bg-muted/30 py-1">
          {servers.map((s) => (
            <li
              key={s.name}
              title={s.error ?? s.name}
              className="truncate px-2.5 py-1 ps-8 text-[12px] leading-5 text-muted-foreground"
            >
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function TaskSection({ todos, live }: { todos: TodoItem[]; live: boolean }) {
  const done = todos.filter((t) => t.status.toLowerCase() === "completed").length;
  const active = todos.filter((t) => t.status.toLowerCase() !== "cancelled").length;

  return (
    <Section title="Task list" summary={todos.length > 0 ? `${done}/${active} done` : undefined}>
      {todos.length === 0 ? (
        <Empty>{live ? "The agent hasn't planned any tasks yet" : "Session is not running"}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Progres: bar tipis — cepat dibaca tanpa menghitung item. */}
          {active > 0 && (
            <div
              role="progressbar"
              aria-label="Task progress"
              aria-valuemin={0}
              aria-valuemax={active}
              aria-valuenow={done}
              className="mx-1 h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${(done / active) * 100}%` }}
              />
            </div>
          )}
          <Box>
            {todos.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: urutan = urutan task list agent
              <TodoRow key={`${i}-${t.content}`} todo={t} />
            ))}
          </Box>
        </div>
      )}
    </Section>
  );
}

/**
 * Jumlah file yang langsung tampil. Sisanya di balik "Show N more" supaya
 * Reference tidak mendorong bagian lain (Task list, MCP) keluar pandangan
 * saat agent membaca puluhan file. Daftar sudah terbaru-di-atas, jadi yang
 * tersembunyi adalah file yang paling lama tidak disentuh.
 */
export const REFERENCE_PREVIEW = 8;

function ReferenceSection({ references }: { references: FileReference[] }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = Math.max(0, references.length - REFERENCE_PREVIEW);
  const visible = showAll ? references : references.slice(0, REFERENCE_PREVIEW);

  return (
    <Section
      title="Reference"
      summary={references.length > 0 ? String(references.length) : undefined}
    >
      {references.length === 0 ? (
        <Empty>Files the agent reads will appear here</Empty>
      ) : (
        <>
          <Box>
            {visible.map((ref) => (
              <Row
                key={ref.path}
                icon={<FileTextIcon />}
                label={baseName(ref.path)}
                // Folder induk sebagai konteks; path lengkap di `title`.
                hint={parentDir(ref.path)}
                title={ref.path}
              />
            ))}
          </Box>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {showAll ? "Show less" : `Show ${hidden} more`}
              <ChevronDownIcon
                aria-hidden
                className={cn("size-3 transition-transform duration-200", showAll && "rotate-180")}
              />
            </button>
          )}
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------ helpers ----

/** Teks sinkronisasi cabang terhadap upstream. */
function syncLabel(ahead: number | null, behind: number | null, hasRemote: boolean): string {
  if (!hasRemote) return "No remote";
  if (ahead === null) return "Not pushed yet";
  const pull = behind ?? 0;
  if (ahead === 0 && pull === 0) return "Up to date";
  const parts: string[] = [];
  if (ahead > 0) parts.push(`${ahead} to push`);
  if (pull > 0) parts.push(`${pull} to pull`);
  return parts.join(" · ");
}

/** Folder induk dari path relatif ("src/lib/a.ts" -> "src/lib"). */
function parentDir(p: string): string | undefined {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : undefined;
}

// ---------------------------------------------------------- primitives ----

/** Bagian yang bisa dilipat: judul + ringkasan di kanan judul. */
function Section({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-1.5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group/section flex min-h-7 items-center gap-1 rounded-md px-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform duration-200",
              !expanded && "-rotate-90",
            )}
          />
          <span className="text-[13px] font-semibold tracking-tight text-foreground">{title}</span>
          {summary !== undefined && (
            <span className="ml-auto truncate ps-2 text-[11px] text-muted-foreground">
              {summary}
            </span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Boxed list (libadwaita): kartu membulat, baris dipisah garis tipis. */
function Box({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {children}
    </ul>
  );
}

/** Satu baris dalam `Box`: ikon + label (+ petunjuk kecil) + nilai di kanan. */
function Row({
  icon,
  label,
  hint,
  hintTone,
  value,
  muted,
  mono,
  title,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  /** Warna baris kedua (mis. pesan error). */
  hintTone?: "error";
  value?: ReactNode;
  muted?: boolean;
  mono?: boolean;
  title?: string;
}) {
  return (
    <li
      title={title}
      className="flex min-h-9 min-w-0 items-center gap-2 px-2.5 py-1.5 text-[12.5px]"
    >
      <span
        aria-hidden
        className="flex shrink-0 items-center text-muted-foreground [&>svg]:size-3.5"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate leading-5",
            muted && "text-muted-foreground",
            mono && "font-mono text-[12px]",
          )}
        >
          {label}
        </span>
        {hint && (
          <span
            className={cn(
              "truncate text-[11px] leading-4",
              hintTone === "error" ? "text-destructive/90" : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
        )}
      </span>
      {value !== undefined && <span className="shrink-0">{value}</span>}
    </li>
  );
}

/** +tambah / -hapus berwarna. */
function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
      <span className="text-destructive">-{removed}</span>
    </span>
  );
}

/** Label status task untuk pembaca layar. */
const TODO_STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  in_progress: "In progress",
  pending: "Pending",
  cancelled: "Cancelled",
};

/** Satu item task list: ikon status + teks (selesai dicoret). */
function TodoRow({ todo }: { todo: TodoItem }) {
  const status = todo.status.toLowerCase();
  const done = status === "completed";
  const cancelled = status === "cancelled";
  const running = status === "in_progress";

  return (
    <li className="flex min-w-0 items-start gap-2 px-2.5 py-2 text-[12.5px] leading-snug">
      {/* Ikon status dekoratif; statusnya dibacakan lewat teks sr-only di
          bawah (aria-label pada span/svg biasa tidak dibaca pembaca layar). */}
      <span aria-hidden className="mt-0.5 flex shrink-0 items-center">
        {done ? (
          <span className="flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <CheckIcon className="size-2" strokeWidth={4} />
          </span>
        ) : running ? (
          <LoaderIcon className="size-3.5 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-400" />
        ) : (
          <CircleIcon className="size-3.5 text-muted-foreground/60" />
        )}
      </span>
      <span className="sr-only">{TODO_STATUS_LABEL[status] ?? "Pending"}: </span>
      <span
        className={cn(
          "min-w-0 break-words",
          done && "text-muted-foreground line-through decoration-muted-foreground/50",
          cancelled && "text-muted-foreground/60 line-through",
          running && "font-medium",
        )}
      >
        {todo.content}
      </span>
    </li>
  );
}

/** Keadaan kosong — tetap di dalam boxed list agar bentuk bagian konsisten. */
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-2.5 py-2.5 text-[12px] leading-snug text-muted-foreground">
      {children}
    </p>
  );
}

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[3, 2, 2].map((rows, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: kerangka statis
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="mx-1 h-3.5 w-24" />
          <div className="flex flex-col gap-1.5 px-1">
            {Array.from({ length: rows }, (_, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: kerangka statis
              <Skeleton key={j} className="h-6" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
