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
 * - Tingkat naik/turun -> card bergetar singkat (`shakeKeyframes`), makin
 *   kuat di tingkat yang lebih tinggi.
 * - Tingkat tertinggi (Max) -> api menyala di BELAKANG card (`EffortFire`):
 *   card tetap utuh, hanya tepinya menghangat dan trough/knob ikut menyala.
 *   Ikut pratinjau saat digeser, jadi api menyala begitu knob menyentuh ujung
 *   kanan.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";
import { EffortFire } from "@/components/sessions/EffortFire";
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

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Keyframe getaran card saat tingkat berubah: hentakan pertama searah
 * perubahan (`dir` 1 = naik/kanan, -1 = turun/kiri), lalu memantul dan
 * meredam kembali ke posisi semula. `level` 0..1 (terendah..tertinggi):
 * makin tinggi tingkatnya makin kuat (1.5–4px, miring maks 0.35°).
 */
export function shakeKeyframes(dir: 1 | -1, level: number): Keyframe[] {
  const amp = 1.5 + 2.5 * level;
  return [0, 1, -0.75, 0.5, -0.25, 0].map((k) => ({
    transform: `translateX(${(k * dir * amp).toFixed(2)}px) rotate(${(k * dir * level * 0.35).toFixed(2)}deg)`,
  }));
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
  /** Tingkat tertinggi model (ujung "Smarter") -> card terbakar. */
  const onFire = n > 1 && idx === n - 1;

  const cardRef = useRef<HTMLUListElement>(null);
  const prevIdx = useRef(idx);
  const shakeAnim = useRef<Animation | null>(null);

  // Card bergetar tiap kali tingkat naik/turun (termasuk pratinjau saat
  // digeser) — bukan saat switch dinyalakan/dimatikan. WAAPI langsung di
  // elemen: card tidak di-remount (fokus slider tetap) dan getaran bisa
  // dimulai ulang di tengah jalan. Reduced motion dicek manual karena aturan
  // global di src/index.css hanya mematikan animasi CSS.
  useEffect(() => {
    const prev = prevIdx.current;
    prevIdx.current = idx;
    const el = cardRef.current;
    if (prev < 0 || idx < 0 || prev === idx || !el || typeof el.animate !== "function") return;
    if (window.matchMedia?.(REDUCED_MOTION).matches) return;
    shakeAnim.current?.cancel();
    shakeAnim.current = el.animate(shakeKeyframes(idx > prev ? 1 : -1, idx / Math.max(1, n - 1)), {
      // Masuk ke Max (api menyala) sedikit lebih lama — "hentakan" nyala.
      duration: idx === n - 1 ? 420 : 320,
      easing: "ease-out",
    });
  }, [idx, n]);

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
    // Sengaja TANPA `isolate`: api (`EffortFire`, -z-10) harus bisa turun ke
    // belakang seluruh isi dialog, bukan hanya ke belakang card ini.
    <div className={cn("relative", className)}>
      <EffortFire active={onFire} />
      <ul
        ref={cardRef}
        aria-label="Thinking effort"
        className={cn(
          "relative flex flex-col divide-y overflow-hidden rounded-xl border bg-card shadow-xs transition-colors duration-300",
          onFire && "border-orange-500/50",
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
              <span
                className={cn(
                  "truncate text-[13px] leading-snug text-muted-foreground",
                  onFire && "font-medium text-orange-600 dark:text-amber-300",
                )}
              >
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
                    onFire && "bg-linear-to-r from-amber-300 via-orange-500 to-red-500",
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
                    onFire &&
                      "border-amber-200 bg-amber-50 shadow-[0_0_10px_3px_rgb(249_115_22/0.75)] group-hover:shadow-[0_0_14px_4px_rgb(249_115_22/0.85)]",
                  )}
                  style={{ left: markLeft(idx, n) }}
                />
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">Smarter</span>
          </li>
        )}
      </ul>
    </div>
  );
}
