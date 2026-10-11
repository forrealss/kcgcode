/**
 * Kolom cari ala GtkSearchEntry (libadwaita): latar terisi tanpa border,
 * ikon kaca pembesar di kiri, tombol hapus bundar saat berisi, ring fokus
 * aksen. Esc mengosongkan isi (bila ada) sebelum diteruskan ke pemanggil.
 *
 * Teks 16px di HP agar iOS Safari tidak men-zoom halaman saat fokus.
 */
import { SearchIcon, XIcon } from "lucide-react";
import { type ComponentProps, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SearchEntryProps
  extends Omit<ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Kelas untuk pembungkus (lebar, margin). */
  className?: string;
}

export function SearchEntry({
  value,
  onValueChange,
  className,
  onKeyDown,
  ref,
  ...props
}: SearchEntryProps) {
  const localRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={cn("relative", className)}>
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={(el) => {
          localRef.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Escape" && value !== "") {
            e.preventDefault();
            onValueChange("");
          }
        }}
        className="h-9 w-full rounded-lg bg-black/[0.06] pr-9 pl-9 text-base outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:text-sm dark:bg-white/[0.08] [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            localRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
