/** Potongan dipakai bersama kartu & viewer perubahan: gaya status, hitungan. */
import type { TurnDiff, TurnFileChange } from "@/types";

export const STATUS_STYLE: Record<TurnFileChange["status"], { letter: string; className: string }> =
  {
    added: { letter: "A", className: "text-emerald-600 dark:text-emerald-400" },
    modified: { letter: "M", className: "text-amber-600 dark:text-amber-400" },
    deleted: { letter: "D", className: "text-destructive" },
    renamed: { letter: "R", className: "text-sky-600 dark:text-sky-400" },
  };

export function totals(diff: TurnDiff): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const f of diff.files) {
    add += f.additions ?? 0;
    del += f.deletions ?? 0;
  }
  return { add, del };
}

export function splitPath(p: string): { name: string; dir: string } {
  const i = p.lastIndexOf("/");
  return i === -1 ? { name: p, dir: "" } : { name: p.slice(i + 1), dir: p.slice(0, i) };
}

export function Counts({ add, del }: { add: number | null; del: number | null }) {
  if (add === null && del === null)
    return <span className="text-xs text-muted-foreground">bin</span>;
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{add ?? 0}</span>{" "}
      <span className="text-destructive">−{del ?? 0}</span>
    </span>
  );
}
