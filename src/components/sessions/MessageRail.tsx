/**
 * Rail penanda pesan user di tepi kiri timeline (ala Gemini).
 *
 * Satu garis pendek & tebal per pesan user, urut dari atas ke bawah. Diklik
 * -> melompat ke pesan itu; di-hover -> garis memanjang dan berbunyi satu
 * nada. Nadanya menaik dari atas ke bawah (tangga nada mayor: do re mi …),
 * jadi menyapu rail terdengar seperti memainkan tangga nada. Penanda yang
 * sedang tampil di layar dibuat lebih kontras sehingga rail sekaligus jadi
 * indikator posisi baca.
 *
 * Catatan implementasi:
 * - Posisi penanda TIDAK proporsional terhadap tinggi dokumen (bukan
 *   minimap): jaraknya tetap, ditempatkan di tengah tepi kiri.
 * - Jumlah penanda tidak dibatasi (tiap pesan user selalu dapat satu).
 *   Percakapan panjang -> rail melebihi tinggi maksimumnya lalu bisa
 *   di-scroll; rail MENGGESER DIRINYA agar penanda aktif selalu terlihat,
 *   sehingga penanda lama tetap terjangkau tanpa perlu dibuang.
 * - Penanda aktif ditentukan `IntersectionObserver` di `SessionTimeline`
 *   (elemen pesan user), jadi tidak ada perhitungan scroll manual.
 * - Disembunyikan di layar sempit (`hidden lg:flex`): tidak ada ruang di
 *   tepi kiri HP, dan rail bukan satu-satunya cara navigasi.
 * - Hanya muncul bila ada ≥ 2 pesan user (satu penanda tidak berguna).
 */
import { useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { playTone, scaleFrequency } from "@/lib/tone";
import { cn } from "@/lib/utils";

/**
 * Jeda sebelum tooltip muncul. Provider global memakai 0 (tombol ikon perlu
 * respons cepat), tapi di rail penanda berdempetan: tanpa jeda, menyapu
 * pointer melintasinya memunculkan tooltip berkedip-kedip. Nilai ini
 * menimpa provider hanya untuk rail.
 */
const TOOLTIP_DELAY_MS = 450;

export interface UserMessageMark {
  id: string;
  /** Cuplikan teks pesan untuk tooltip & label aksesibilitas. */
  preview: string;
}

export interface MessageRailProps {
  marks: UserMessageMark[];
  /** Id pesan user yang sedang tampil (penanda aktif). */
  activeId: string | null;
  onJump: (id: string) => void;
}

export function MessageRail({ marks, activeId, onJump }: MessageRailProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  // Rail lebih tinggi dari batasnya -> jaga penanda aktif tetap dalam
  // pandangan. `block: "nearest"` hanya menggeser bila penanda memang di luar
  // area, jadi rail tidak bergerak-gerak saat penanda aktif sudah terlihat.
  useEffect(() => {
    const list = listRef.current;
    if (list === null || activeId === null) return;
    if (list.scrollHeight <= list.clientHeight) return;
    // Id pesan berbentuk `usr_<uuid>`, tapi selector tetap di-escape bila
    // `CSS.escape` tersedia — id tak lazim tidak boleh merusak rail.
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(activeId) : activeId;
    const el = list.querySelector<HTMLElement>(`[data-mark-id="${escaped}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  if (marks.length < 2) return null;

  return (
    <nav
      aria-label="Your messages"
      className="pointer-events-none absolute top-1/2 left-4 hidden -translate-y-1/2 lg:flex xl:left-6"
    >
      <ul
        ref={listRef}
        className="pointer-events-auto flex max-h-[60vh] flex-col items-center gap-px overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {marks.map((mark, i) => {
          const active = mark.id === activeId;
          return (
            <li key={mark.id} data-mark-id={mark.id}>
              <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onJump(mark.id)}
                    // Nada hanya saat pointer masuk (bukan tiap gerakan), dan
                    // tidak untuk fokus keyboard agar Tab tidak berbunyi.
                    onPointerEnter={(e) => {
                      // Sentuhan langsung jadi klik — nada hover tidak relevan.
                      if (e.pointerType !== "touch") playTone(scaleFrequency(i));
                    }}
                    aria-label={`Jump to your message ${i + 1}: ${mark.preview}`}
                    aria-current={active ? "true" : undefined}
                    // Area klik 24px (nyaman ditunjuk), garisnya sendiri tipis.
                    className="group/mark flex h-3 w-7 items-center justify-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        // Pendek & agak tebal; memanjang saat hover / fokus.
                        "block h-[3px] rounded-full transition-[width,background-color] duration-200",
                        "group-hover/mark:w-7 group-focus-visible/mark:w-7",
                        active
                          ? "w-[18px] bg-foreground/70"
                          : "w-3.5 bg-foreground/30 group-hover/mark:bg-foreground/60",
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-56">
                  <span className="line-clamp-2">{mark.preview}</span>
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
