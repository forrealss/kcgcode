/**
 * Satu seksi di panel samping halaman Project (Instructions / MCP / Skills).
 *
 * Header = tombol lipat (judul + hitungan + chevron) dengan slot aksi di
 * kanan; status buka/tutup diingat per seksi di `localStorage` agar panel
 * tetap seperti terakhir ditinggalkan. Isi dirender apa adanya — gaya daftar
 * (kotak berdivider) diserahkan ke `PanelList`.
 */
import { ChevronRightIcon } from "lucide-react";
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
  /** Hitungan / ringkasan kecil di samping judul. */
  meta?: ReactNode;
  /** Tombol aksi kecil di kanan header (tidak ikut melipat). */
  action?: ReactNode;
  children: ReactNode;
}

export function PanelSection({ id, title, meta, action, children }: PanelSectionProps) {
  const [open, setOpen] = usePersistedOpen(id);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section aria-label={title} className="flex flex-col">
        <div className="flex h-9 items-center gap-1">
          <CollapsibleTrigger className="group -ml-1.5 flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-2 pl-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronRightIcon
              className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90"
              aria-hidden
            />
            <span className="text-[13px] font-semibold tracking-tight">{title}</span>
            {meta !== undefined && (
              <span className="truncate text-xs tabular-nums text-muted-foreground">{meta}</span>
            )}
          </CollapsibleTrigger>
          {action && <div className="flex shrink-0 items-center">{action}</div>}
        </div>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="pt-2 pb-1">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/**
 * Kotak daftar berdivider (gaya "grouped list"): baris di dalamnya punya
 * padding horizontal sendiri yang sama kiri-kanan, jadi tidak ada lagi
 * margin negatif yang membuat jarak ke tepi terlihat timpang.
 */
export function PanelList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ul
      className={cn(
        "flex flex-col divide-y overflow-hidden rounded-xl border bg-card text-card-foreground",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** Keterangan saat daftar kosong — satu gaya untuk semua seksi. */
export function PanelHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
