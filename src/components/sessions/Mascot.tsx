import { cn } from "@/lib/utils";
import logoUrl from "@/logo.svg";

/**
 * Maskot status turn: logo KCG Code + keterangan proses yang sedang
 * berjalan ("Working…", "Thinking…", "read package.json", "Writing…").
 *
 * Tiga mode:
 * - `active`  : logo berdenyut (pulse) + label status (turn masih berjalan).
 * - `standby` : logo diam tanpa label — penanda model "hadir" setelah pesan
 *   terakhir selesai (masih dirender, tidak disembunyikan).
 * - keduanya off + label kosong -> tidak dirender (belum ada turn).
 */
export function Mascot({
  label,
  active = false,
  standby = false,
  className,
}: {
  /** Teks status; kosong/null -> mode standby (logo saja) bila `standby`. */
  label: string | null;
  /** true -> logo beranimasi (turn masih berjalan). */
  active?: boolean;
  /** true -> tetap tampil sebagai logo diam walau tanpa label (selesai). */
  standby?: boolean;
  className?: string;
}) {
  const empty = label === null || label === "";
  // Tanpa label & bukan standby -> tidak ada yang perlu dirender.
  if (empty && !standby) return null;

  return (
    <div
      className={cn("flex items-center gap-2.5 py-1 text-sm text-muted-foreground", className)}
      role="status"
      aria-live="polite"
    >
      <img
        src={logoUrl}
        alt=""
        aria-hidden
        className={cn("size-5 shrink-0", active && "animate-pulse", empty && "opacity-60")}
      />
      {!empty && <span className="truncate">{label}</span>}
    </div>
  );
}
