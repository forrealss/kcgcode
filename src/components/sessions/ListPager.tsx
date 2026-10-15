/**
 * Pagination kecil di bawah boxed list ("6–10 of 12" + tombol sebelumnya /
 * berikutnya). Tidak dirender bila daftar muat dalam satu halaman.
 */
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Page } from "@/lib/pagination";

export function ListPager({
  page,
  label,
  onPageChange,
}: {
  page: Page<unknown>;
  /** Nama daftar untuk label aksesibilitas (mis. "sessions"). */
  label: string;
  onPageChange: (page: number) => void;
}) {
  if (page.pageCount <= 1) return null;
  return (
    <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-3 px-1">
      <p className="text-[13px] text-muted-foreground tabular-nums" aria-live="polite">
        {page.from}–{page.to} of {page.total}
      </p>
      <div className="-mr-2 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label={`Previous ${label}`}
          disabled={page.page === 0}
          onClick={() => onPageChange(page.page - 1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label={`Next ${label}`}
          disabled={page.page >= page.pageCount - 1}
          onClick={() => onPageChange(page.page + 1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
}
