/**
 * "Plate" animasi drop file: saat file dilepas, kartu "Add anything"
 * berubah menjadi plate berisi tumpukan file; plate lalu MENYUSUT menjadi
 * kotak composer, sementara tiap file terbang ke slot preview-nya masing-
 * masing di atas input.
 *
 * Kenapa terbaca sebagai "geser", bukan "fade":
 * - Setiap file punya perjalanan sendiri: dari tumpukan besar di tengah
 *   kartu (skala besar, sedikit miring, bertumpuk) ke slot aslinya (skala 1).
 *   Perubahan skala + posisi + rotasi inilah yang dilihat mata sebagai
 *   perpindahan. Satu grup yang ditranslasi utuh (versi lama) tidak
 *   menyusut bila isinya sudah lebar, jadi hanya tampak bergeser lalu hilang.
 * - Latar plate mendarat tepat di KOTAK COMPOSER (warna & sudut serupa),
 *   lalu memudar ke dalamnya — tidak ada kotak besar yang "menghilang" di
 *   ruang kosong.
 *
 * FLIP tanpa fitur `layout` Motion (`domAnimation`): composer merender item
 * baru tak terlihat, mengukur rect akhir tiap item + kotak composer, lalu
 * komponen ini merender salinan item di posisi akhir dan menganimasikan
 * transform dari posisi tumpukan menuju identitas. Selesai -> `onDone`
 * memunculkan item asli di frame yang sama (posisinya identik).
 *
 * Portal ke `document.body` (position fixed tidak boleh terjebak ancestor
 * ber-transform). Reduce motion -> dilewati langsung.
 */
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AttachmentVisual, type PendingAttachment } from "@/components/sessions/PendingAttachments";

export interface DropPlateProps {
  /** Rect kartu overlay saat file dilepas (viewport). */
  from: DOMRect;
  /** Rect akhir tiap item di deretan lampiran (viewport). */
  items: { item: PendingAttachment; rect: DOMRect }[];
  /** Rect kotak composer; null -> plate menyusut ke gabungan item. */
  box: DOMRect | null;
  onDone: () => void;
}

/** Rect gabungan beberapa rect. */
function unionRect(rects: DOMRect[]): { x: number; y: number; w: number; h: number } {
  const x = Math.min(...rects.map((r) => r.left));
  const y = Math.min(...rects.map((r) => r.top));
  const r = Math.max(...rects.map((q) => q.right));
  const b = Math.max(...rects.map((q) => q.bottom));
  return { x, y, w: r - x, h: b - y };
}

/** Jeda sebelum terbang: file terlihat "masuk" ke plate (detik). */
const HOLD = 0.12;
/** Durasi visual terbang (detik). */
const FLY = 0.55;
/** Ukuran tumpukan di tengah kartu: sisi terpanjang item = porsi kartu ini. */
const PILE_FILL = 0.42;
/** Maksimal item yang tampak di tumpukan; sisanya menumpuk di belakang. */
const PILE_SPREAD = 3;
/** Jeda antar file saat terbang (detik) & batasnya. */
const STAGGER = 0.035;
const MAX_STAGGER = 0.12;

export function DropPlate({ from, items, box, onDone }: DropPlateProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) onDone();
  }, [reduce, onDone]);
  // Selesai berdasarkan waktu, bukan `onAnimationComplete`: spring baru
  // "diam" ±0.5 detik setelah gerakannya tak lagi terlihat, dan selama itu
  // preview asli masih tersembunyi (tidak bisa diklik / dihapus). Salinan
  // sudah berada di posisi akhir saat ini, jadi pergantiannya tak terlihat.
  // Sekaligus jaring pengaman bila animasi dibatalkan (tab di latar).
  const endMs = (HOLD + Math.min((items.length - 1) * STAGGER, MAX_STAGGER) + FLY) * 1000 + 60;
  useEffect(() => {
    const id = setTimeout(onDone, endMs);
    return () => clearTimeout(id);
  }, [onDone, endMs]);
  if (reduce || items.length === 0) return null;

  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const land = box
    ? { x: box.left, y: box.top, w: box.width, h: box.height }
    : unionRect(items.map((i) => i.rect));

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      {/* Latar plate: kartu -> kotak composer, lalu larut ke dalamnya. */}
      <m.div
        className="absolute top-0 left-0 border bg-popover shadow-2xl will-change-transform"
        initial={{
          x: from.left,
          y: from.top,
          width: from.width,
          height: from.height,
          borderRadius: 28,
          opacity: 1,
        }}
        animate={{
          x: land.x,
          y: land.y,
          width: land.w,
          height: land.h,
          borderRadius: 12,
          opacity: 0,
        }}
        transition={{
          default: { type: "spring", visualDuration: FLY, bounce: 0, delay: HOLD },
          // Memudar hanya di ekor perjalanan: saat itu ukurannya sudah
          // sama dengan kotak composer, jadi yang terlihat adalah plate
          // "menjadi" composer, bukan kotak yang lenyap.
          opacity: { duration: 0.18, delay: HOLD + FLY * 0.8, ease: "easeOut" },
        }}
      />

      {/* Tiap file: dari tumpukan di tengah kartu ke slot preview-nya. */}
      {items.map(({ item, rect }, i) => {
        // Skala tumpukan: item terlihat besar di kartu, tapi tidak lebih
        // besar dari porsi kartu.
        const pileScale = Math.min(
          2.6,
          Math.max(
            1.3,
            (Math.min(from.width, from.height) * PILE_FILL) / Math.max(rect.width, rect.height),
          ),
        );
        // Posisi dalam tumpukan: sedikit menyebar & miring bergantian.
        const slot = Math.min(i, PILE_SPREAD - 1) - (Math.min(items.length, PILE_SPREAD) - 1) / 2;
        const offsetX = slot * 26;
        const offsetY = Math.abs(slot) * 6;
        const rotate = slot * 7;
        // Transform relatif ke posisi akhir (pusat item -> pusat tumpukan).
        const dx = cx + offsetX - (rect.left + rect.width / 2);
        const dy = cy + offsetY - (rect.top + rect.height / 2) - from.height * 0.06;
        const delay = HOLD + Math.min(i * STAGGER, MAX_STAGGER);
        return (
          <m.div
            key={item.key}
            className="absolute will-change-transform"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              zIndex: items.length - i,
            }}
            initial={{ x: dx, y: dy, scale: pileScale, rotate, opacity: 0 }}
            animate={{ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }}
            transition={{
              default: { type: "spring", visualDuration: FLY, bounce: 0.12, delay },
              // Muncul cepat di tumpukan (pop), lalu tetap solid sepanjang jalan.
              opacity: { duration: 0.1 },
            }}
          >
            <div className="size-full shadow-lg [&>*]:shadow-none" style={{ borderRadius: 10 }}>
              <AttachmentVisual item={item} />
            </div>
          </m.div>
        );
      })}
    </div>,
    document.body,
  );
}
