/**
 * Satu seksi di panel samping halaman Project (Instructions / MCP / Skills).
 *
 * Tiap seksi = satu kartu (gaya boxed list seperti Settings): header di dalam
 * kartu (ikon, judul, ringkasan, aksi, chevron) dan isi di bawah garis
 * pemisah. Status buka/tutup diingat per seksi di `localStorage`.
 *
 * Isi kartu tidak diberi padding otomatis: `PanelList` (baris berdivider),
 * `PanelHint`, dan `PanelBody` mengatur jaraknya sendiri agar baris daftar
 * bisa rata tepi ke tepi.
 */
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "kcg.projectPanel.";

/** Buka/tutup seksi yang diingat di localStorage (default terbuka). */
function usePersistedOpen(id: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_PREFIX + id) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PREFIX + id, open ? "1" : "0");
    } catch {
      // Storage tidak tersedia (mode privat) — cukup state di memori.
    }
  }, [id, open]);
  return [open, setOpen];
}

export interface PanelSectionProps {
  /** Id stabil untuk mengingat status lipat (mis. "mcp"). */
  id: string;
  title: string;
  /** Ikon seksi di kiri judul. */
  icon: ReactNode;
  /** Hitungan / ringkasan kecil di bawah judul. */
  meta?: ReactNode;
  /** Tombol aksi kecil di kanan header (tidak ikut melipat). */
  action?: ReactNode;
  children: ReactNode;
}

export function PanelSection({ id, title, icon, meta, action, children }: PanelSectionProps) {
  const [open, setOpen] = usePersistedOpen(id);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section
        aria-label={title}
        className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs"
      >
        <div className="flex items-center gap-1 pr-2">
          <CollapsibleTrigger className="group flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4"
              aria-hidden
            >
              {icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold leading-5 tracking-tight">{title}</span>
              {meta !== undefined && (
                <span className="truncate text-xs tabular-nums text-muted-foreground">{meta}</span>
              )}
            </span>
            <ChevronDownIcon
              className="mr-1.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          {action && <div className="flex shrink-0 items-center">{action}</div>}
        </div>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="border-t">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/** Isi kartu dengan padding standar (form, pencarian, teks). */
export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-3.5 py-3", className)}>{children}</div>;
}

/** Baris-baris berdivider, rata tepi ke tepi di dalam kartu. */
export function PanelList({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn("flex flex-col divide-y", className)}>{children}</ul>;
}

/** Keterangan saat daftar kosong — satu gaya untuk semua seksi. */
export function PanelHint({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-3.5 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}
