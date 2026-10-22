/** Kartu di bawah turn assistant: ringkasan file yang diubah. */
import { ChevronRightIcon, FileDiffIcon } from "lucide-react";
import type { TurnDiff } from "@/types";
import { Counts, totals } from "./shared";

export function TurnChangesCard({ diff, onOpen }: { diff: TurnDiff; onOpen: () => void }) {
  const { add, del } = totals(diff);
  const n = diff.files.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {n} {n === 1 ? "file" : "files"} changed
      </span>
      <Counts add={add} del={del} />
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}
