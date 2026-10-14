/** Primitif tampilan bersama bagian-bagian kartu konteks (gaya libadwaita). */
import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Bagian yang bisa dilipat: judul + ringkasan di kanan judul. */
export function Section({
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
export function Box({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {children}
    </ul>
  );
}

/** Tata letak satu baris `Box` (juga dipakai baris yang bisa diketuk). */
export const ROW = "flex min-h-9 min-w-0 items-center gap-2 px-2.5 py-1.5 text-[12.5px]";

interface RowContentProps {
  icon: ReactNode;
  label: string;
  hint?: string;
  /** Warna baris kedua (mis. pesan error). */
  hintTone?: "error";
  value?: ReactNode;
  muted?: boolean;
  mono?: boolean;
}

/** Satu baris dalam `Box`: ikon + label (+ petunjuk kecil) + nilai di kanan. */
export function Row({ title, ...props }: RowContentProps & { title?: string }) {
  return (
    <li title={title} className={ROW}>
      <RowContent {...props} />
    </li>
  );
}

export function RowContent({ icon, label, hint, hintTone, value, muted, mono }: RowContentProps) {
  return (
    <>
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
    </>
  );
}

/** Keadaan kosong — tetap di dalam boxed list agar bentuk bagian konsisten. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-2.5 py-2.5 text-[12px] leading-snug text-muted-foreground">
      {children}
    </p>
  );
}

export function CardSkeleton() {
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
