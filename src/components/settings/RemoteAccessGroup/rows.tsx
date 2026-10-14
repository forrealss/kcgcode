/** Baris & ikon bersama panel Remote access (kedua penyedia). */
import { CircleAlertIcon, GlobeIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PrefsGroup } from "@/components/settings/prefs";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type Tone = "success" | "busy" | "warning" | "muted";

/** Placeholder grup selama status penyedia belum termuat. */
export function LoadingGroup() {
  return (
    <PrefsGroup>
      <li className="flex min-h-14 items-center justify-center" role="status">
        <Spinner className="size-5 text-muted-foreground" />
        <span className="sr-only">Loading remote access…</span>
      </li>
    </PrefsGroup>
  );
}

/**
 * AdwSwitchRow: ikon, judul + status di subjudul, switch di kanan. Seluruh
 * baris adalah label switch (klik di mana saja mengubahnya).
 */
export function SwitchRow({
  id,
  icon,
  title,
  subtitle,
  checked,
  disabled,
  busy,
  onChange,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-14 items-center gap-3 px-4 py-2.5",
          !disabled && "cursor-pointer",
        )}
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
          <span className="text-[15px] leading-5">{title}</span>
          <span role="status" className="text-[13px] leading-snug text-muted-foreground">
            {subtitle}
          </span>
        </span>
        {busy && <Spinner className="size-4 text-muted-foreground" aria-hidden />}
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </label>
    </li>
  );
}

export function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "busy" && "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        tone === "warning" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        tone === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {tone === "busy" ? (
        <Spinner className="size-5" />
      ) : tone === "warning" ? (
        <CircleAlertIcon className="size-5" aria-hidden />
      ) : (
        <GlobeIcon className="size-5" aria-hidden />
      )}
    </span>
  );
}

export function RowGlyph({ icon, destructive }: { icon: ReactNode; destructive?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-9 items-center justify-center rounded-full",
        destructive ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      {icon}
    </span>
  );
}
