/** Daftar file yang berubah dalam satu turn. */
import { cn } from "@/lib/utils";
import type { TurnDiff, TurnFileChange } from "@/types";
import { Counts, STATUS_STYLE, splitPath } from "./shared";

export function FileList({
  diff,
  onPick,
}: {
  diff: TurnDiff;
  onPick: (f: TurnFileChange) => void;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {diff.files.map((f) => {
        const { name, dir } = splitPath(f.path);
        const st = STATUS_STYLE[f.status];
        return (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => onPick(f)}
              className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
            >
              <span className={cn("w-3 shrink-0 font-mono text-xs font-semibold", st.className)}>
                {st.letter}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{name}</span>
                {dir && <span className="truncate text-xs text-muted-foreground">{dir}</span>}
              </span>
              <Counts add={f.additions} del={f.deletions} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
