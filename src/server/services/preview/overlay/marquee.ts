/**
 * Geometri seleksi kotak (marquee): kumpulkan elemen yang SELURUHNYA berada
 * di dalam kotak, hanya yang "terluar" — bila sebuah form tercakup penuh,
 * yang terpilih form-nya, bukan setiap input di dalamnya.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Candidate {
  el: Element;
  rect: DOMRect;
}

/** Elemen yang tidak pernah layak dipilih. */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "BR", "WBR", "META", "LINK"]);
/** Luas minimum (px²) — abaikan elemen kosong / tak terlihat. */
const MIN_AREA = 16;

export function boxFrom(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/**
 * Potret posisi elemen halaman saat drag dimulai (dipakai ulang tiap gerakan
 * agar tidak memanggil `getBoundingClientRect` ribuan kali per frame).
 */
export function snapshotCandidates(host: Element): Candidate[] {
  const out: Candidate[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el === host || SKIP.has(el.tagName)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height >= MIN_AREA) out.push({ el, rect });
  }
  return out;
}

const inside = (r: DOMRect, b: Box) =>
  r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;

/** Elemen terluar yang tercakup penuh oleh kotak, urut sesuai dokumen. */
export function elementsInside(candidates: Candidate[], box: Box): Element[] {
  const contained = candidates.filter((c) => inside(c.rect, box)).map((c) => c.el);
  const set = new Set(contained);
  return contained.filter((el) => !el.parentElement || !set.has(el.parentElement));
}
