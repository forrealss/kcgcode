/**
 * Pemilih tema (Requirement 8.2) di footer sidebar: label "Theme" di kiri,
 * tiga tombol ikon di kanan — Light, Dark, System (ikuti perangkat) — dalam
 * satu segmented control ringkas. Pilihan disimpan `useTheme` di
 * `localStorage["kcg-theme"]` dan diterapkan ke `<html>` (Requirement 8.6).
 *
 * Aksesibilitas: grup radio native (`<input type="radio">` tersembunyi di
 * dalam label), jadi Tab masuk ke pilihan aktif dan panah berpindah opsi.
 * Tombol hanya ikon, jadi nama tiap opsi diberikan lewat teks `sr-only` dan
 * tooltip (`title`).
 */
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useId } from "react";
import { type ThemePreference, useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const name = useId();
  const labelId = useId();

  return (
    <div className={cn("flex items-center justify-between gap-3 px-2", className)}>
      <span id={labelId} className="text-sm text-sidebar-foreground/80">
        Theme
      </span>
      <fieldset
        aria-labelledby={labelId}
        className="flex shrink-0 items-center gap-0.5 rounded-lg border border-sidebar-border bg-sidebar-accent/60 p-0.5"
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = preference === value;
          return (
            <label
              key={value}
              title={value === "system" ? "System (match device)" : label}
              className={cn(
                "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors select-none",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sidebar-ring",
                active
                  ? "bg-sidebar text-sidebar-foreground shadow-sm"
                  : "text-sidebar-foreground/55 hover:text-sidebar-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={active}
                onChange={() => setPreference(value)}
                className="sr-only"
              />
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">{label}</span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
