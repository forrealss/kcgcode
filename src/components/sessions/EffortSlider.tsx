/**
 * Thinking effort ala libadwaita: boxed list berisi baris switch (pola
 * AdwExpanderRow dengan enable switch) dan `GtkScale` di bawahnya.
 *
 * - Switch mati = Automatic (`null`, default agent untuk model ini) — hanya
 *   satu baris. Dinyalakan -> scale muncul dan tingkat awal langsung dipilih
 *   (`high` bila ada — default effort API Claude — selain itu tengah).
 * - Scale: trough tipis, highlight aksen sampai knob, knob bulat, tanda
 *   (mark) kecil per tingkat di bawah trough; kiri "Faster" — kanan "Smarter".
 *   Tingkat berasal dari model (`ModelOption.efforts`), bukan hardcode UI.
 * - Geser = pratinjau (subjudul baris ikut berubah); pilihan dikirim
 *   (`onChange`) saat dilepas — satu PUT per geseran. Panah, Home/End
 *   langsung mengirim.
 * - Selama pilihan disimpan (`disabled`), tampilan tetap di nilai baru
 *   (optimistis) sampai `value` dari pemilik state berubah.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { effortLabel } from "@/lib/model-picker";
import { cn } from "@/lib/utils";

/** Jarak pusat mark pertama/terakhir dari tepi trough (px) = jari-jari knob. */
const EDGE = 10;

/** Posisi CSS `left` mark ke-`i` dari `n`. */
function markLeft(i: number, n: number): string {
  const ratio = n <= 1 ? 0.5 : i / (n - 1);
  return `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${ratio})`;
}

/** Tingkat awal saat effort dipilih manual. */
function initialEffort(efforts: string[]): string | undefined {
  return efforts.includes("high") ? "high" : efforts[Math.floor((efforts.length - 1) / 2)];
}

export interface EffortSliderProps {
  /** Tingkat yang didukung model, urut dari terendah. */
  efforts: string[];
  /** Tingkat aktif; null = Automatic (default agent). */
  value: string | null;
  onChange: (effort: string | null) => void;
  disabled?: boolean;
  className?: string;
}

export function EffortSlider({
  efforts,
  value,
  onChange,
  disabled = false,
  className,
}: EffortSliderProps) {
  const switchId = useId();
  const scaleRef = useRef<HTMLDivElement>(null);
  const n = efforts.length;
  /**
   * Pilihan yang sedang digeser / menunggu disimpan, beserta `value` saat itu
   * — begitu `value` berubah (diterima, atau diganti dari luar) pratinjau
   * tidak berlaku lagi.
   */
  const [pending, setPending] = useState<{ next: string | null; from: string | null } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Pratinjau selesai begitu geseran dilepas dan simpan selesai: berhasil ->
  // `value` sudah baru; gagal -> kembali ke `value` lama.
  useEffect(() => {
    if (!disabled && !dragging) setPending(null);
  }, [disabled, dragging]);

  const current = pending && pending.from === value ? pending.next : value;
  const manual = current !== null;
  const idx = current === null ? -1 : efforts.indexOf(current);

  const preview = (next: string | null) => setPending({ next, from: value });
  const choose = (next: string | null | undefined) => {
    if (next === undefined || next === value) {
      setPending(null);
      return;
    }
    preview(next);
    onChange(next);
  };

  /** Tingkat terdekat dari posisi pointer di scale. */
  const effortAt = (clientX: number): string | undefined => {
    const rect = scaleRef.current?.getBoundingClientRect();
    if (!rect || n <= 1) return efforts[0];
    const ratio = (clientX - rect.left - EDGE) / Math.max(1, rect.width - EDGE * 2);
    return efforts[Math.round(Math.min(1, Math.max(0, ratio)) * (n - 1))];
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    setDragging(true);
    preview(effortAt(e.clientX) ?? null);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) preview(effortAt(e.clientX) ?? null);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    choose(effortAt(e.clientX));
  };
  const onPointerCancel = () => {
    setDragging(false);
    setPending(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || n === 0) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(n - 1, idx + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, idx - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    choose(efforts[next]);
  };

  return (
    <ul
      aria-label="Thinking effort"
      className={cn(
        "flex flex-col divide-y overflow-hidden rounded-xl border bg-card shadow-xs",
        className,
      )}
    >
      {/* AdwExpanderRow + enable switch: seluruh baris jadi label switch. */}
      <li>
        <label
          htmlFor={switchId}
          className={cn(
            "flex min-h-14 items-center gap-3 px-4 py-2.5",
            !disabled && "cursor-pointer",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
            <span className="text-[15px] leading-5">Thinking effort</span>
            <span className="truncate text-[13px] leading-snug text-muted-foreground">
              {current ? effortLabel(current) : "Automatic — the agent decides"}
            </span>
          </span>
          <Switch
            id={switchId}
            checked={manual}
            disabled={disabled}
            onCheckedChange={(on) => choose(on ? initialEffort(efforts) : null)}
            aria-label="Choose thinking effort manually"
          />
        </label>
      </li>

      {manual && (
        <li className="flex items-center gap-3 px-4 py-3">
          <span className="shrink-0 text-xs text-muted-foreground">Faster</span>
          {/* GtkScale: `touch-none` agar geser horizontal tidak ikut
              men-scroll dialog di HP. */}
          <div
            ref={scaleRef}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Thinking effort level"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, n - 1)}
            aria-valuenow={Math.max(0, idx)}
            aria-valuetext={current ? effortLabel(current) : undefined}
            aria-disabled={disabled || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
            className={cn(
              "group relative h-6 min-w-0 flex-1 cursor-pointer touch-none outline-none select-none",
              disabled && "pointer-events-none",
            )}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/15"
            />
            {idx >= 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-primary",
                  !dragging && "transition-[width] duration-150 ease-out",
                )}
                style={{ width: markLeft(idx, n) }}
              />
            )}
            {efforts.map((e, i) => (
              <span
                key={e}
                aria-hidden
                className="absolute top-[calc(50%+5px)] h-1 w-px -translate-x-1/2 bg-foreground/30"
                style={{ left: markLeft(i, n) }}
              />
            ))}
            {idx >= 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/10 bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)]",
                  "group-hover:shadow-[0_1px_4px_rgb(0_0_0/0.4)] group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50",
                  !dragging && "transition-[left,box-shadow] duration-150 ease-out",
                )}
                style={{ left: markLeft(idx, n) }}
              />
            )}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">Smarter</span>
        </li>
      )}
    </ul>
  );
}
