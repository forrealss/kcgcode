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
 *                     gagal, sedang menyambung & tersambung tampil per baris;
 *                     yang perlu login (mis. puluhan konektor claude.ai) dan
 *                     yang tidak aktif DILIPAT jadi satu baris "N need
 *                     sign-in" agar tidak menenggelamkan bagian lain. Ketuk
 *                     server -> menu Reconnect / Enable / Disable.
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
 * Aksi hanya ada di tombol compact dan baris MCP (menu aksi server). Baris
 * lain hanya informasi (belum ada aksi git): tidak dibuat seperti tombol
 * supaya tidak menyiratkan aksi yang belum ada.
 */
import { MenuIcon, XIcon } from "lucide-react";
import * as m from "motion/react-m";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FileReference } from "@/lib/references";
import { cn } from "@/lib/utils";
import type { SessionContext } from "@/types";
import { EnvironmentSection } from "./EnvironmentSection";
import { type McpPanelActions, McpSection } from "./McpSection";
import { CardSkeleton } from "./primitives";
import { ReferenceSection } from "./ReferenceSection";
import { TaskSection } from "./TaskSection";
import { UsageSection } from "./UsageSection";

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
  /** Kendali MCP server; tanpa nilai = baris MCP hanya informasi. */
  mcpActions?: McpPanelActions;
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
  mcpActions,
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
      <McpSection servers={context?.mcp ?? []} live={context?.live ?? false} actions={mcpActions} />
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
