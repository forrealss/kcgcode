/**
 * Mode pilih elemen (ala inspector DevTools), bisa satu atau banyak:
 * - Mouse: elemen di bawah kursor disorot; klik melampirkannya langsung.
 *   Drag menggambar kotak seleksi (elemen yang tercakup penuh ikut
 *   terpilih); ⇧/⌘-klik menambah/membatalkan satu per satu. Setelah ada
 *   pilihan, klik biasa juga menambah/membatalkan; "Attach" / Enter
 *   melampirkan semuanya.
 * - Sentuh: mode Tap (ketuk = pilih/batal, halaman tetap bisa di-scroll)
 *   atau Area (drag menggambar kotak seleksi; scroll dinonaktifkan).
 * - Selama mode aktif, klik/tekan TIDAK diteruskan ke app (link & tombol
 *   tidak jalan). Esc / "Cancel" membatalkan.
 */
import { boxFrom, type Candidate, elementsInside, snapshotCandidates } from "./marquee";
import { createPickerUi, type PickerView } from "./picker-ui";

export interface PickerHandlers {
  /** Jumlah elemen maksimum yang masih boleh dipilih. */
  max: number;
  onPick: (els: Element[]) => void;
  onCancel: () => void;
}

/** Event yang dihentikan agar app tidak bereaksi selama memilih. */
const SWALLOWED = ["mousedown", "mouseup", "touchstart", "touchend"];
/** Jarak gerak (px) sebelum tekan-tahan dianggap drag, bukan klik. */
const DRAG_START = 6;
const NOTICE_MS = 1800;
/** Gaya halaman selama memilih: kursor bidik, tanpa seleksi teks / callout iOS. */
const PAGE_STYLE: Record<string, string> = {
  cursor: "crosshair",
  "user-select": "none",
  "-webkit-user-select": "none",
  "-webkit-touch-callout": "none",
};

export function startPicker(root: HTMLElement, { max, onPick, onCancel }: PickerHandlers): void {
  const host = (root.getRootNode() as ShadowRoot).host;
  const view: PickerView = {
    hover: null,
    selection: [],
    preview: [],
    area: null,
    mode: "tap",
    touch: matchMedia("(pointer: coarse)").matches,
    max,
    notice: null,
  };
  const ui = createPickerUi(root, {
    onMode: (mode) => {
      view.mode = mode;
      view.hover = null;
      render();
    },
    onCancel: () => finish(null),
    onAttach: () => finish(view.selection),
  });
  const render = () => ui.render(view);

  const docStyle = document.documentElement.style;
  const savedStyle = Object.keys(PAGE_STYLE).map((k) => [k, docStyle.getPropertyValue(k)] as const);
  for (const [k, v] of Object.entries(PAGE_STYLE)) docStyle.setProperty(k, v);

  let noticeTimer = 0;
  function notice(text: string): void {
    view.notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      view.notice = null;
      render();
    }, NOTICE_MS);
  }
  const buzz = () => {
    if (view.touch) navigator.vibrate?.(8);
  };

  /** Tambah elemen (yang belum terpilih) sampai batas. */
  function add(els: Element[]): void {
    let added = false;
    for (const el of els) {
      if (view.selection.includes(el)) continue;
      if (view.selection.length >= max) {
        notice(`Up to ${max} ${max === 1 ? "element" : "elements"}`);
        break;
      }
      view.selection.push(el);
      added = true;
    }
    if (added) buzz();
  }
  function toggle(el: Element): void {
    const i = view.selection.indexOf(el);
    if (i >= 0) view.selection.splice(i, 1);
    else add([el]);
    view.hover = el;
    render();
  }

  // ---- Seleksi kotak (dipakai mouse & mode Area sentuh) ----
  let drag: { x: number; y: number; candidates: Candidate[] | null } | null = null;
  function dragMove(x: number, y: number): boolean {
    if (!drag) return false;
    if (!drag.candidates) {
      if (Math.hypot(x - drag.x, y - drag.y) < DRAG_START) return false;
      drag.candidates = snapshotCandidates(host);
    }
    view.area = boxFrom(drag, { x, y });
    view.preview = elementsInside(drag.candidates, view.area);
    render();
    return true;
  }
  /** `true` bila gerakan tadi memang drag (bukan klik/ketuk). */
  function dragEnd(): boolean {
    const wasDrag = drag?.candidates != null;
    if (wasDrag) {
      if (view.preview.length === 0) notice("Nothing is fully inside the area");
      else add(view.preview);
    }
    drag = null;
    view.area = null;
    view.preview = [];
    render();
    return wasDrag;
  }

  // ---- Input halaman (fase capture, sebelum handler app) ----
  const ours = (e: Event) => e.target === host;
  let lastPointer = "mouse";
  let suppressClick = false;

  function onPointerDown(e: PointerEvent): void {
    if (ours(e)) return;
    e.stopImmediatePropagation();
    lastPointer = e.pointerType;
    if (e.pointerType !== "mouse") view.touch = true;
    else if (e.button === 0) drag = { x: e.clientX, y: e.clientY, candidates: null };
  }
  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType !== "mouse" || ours(e)) return;
    if (dragMove(e.clientX, e.clientY)) return;
    view.hover = e.target as Element;
    render();
  }
  function onPointerUp(e: PointerEvent): void {
    if (ours(e)) return;
    e.stopImmediatePropagation();
    if (e.pointerType === "mouse" && dragEnd()) suppressClick = true;
  }
  function swallow(e: Event): void {
    if (ours(e)) return;
    e.stopImmediatePropagation();
    // Cegah fokus & seleksi teks oleh mouse; sentuhan dibiarkan agar scroll jalan.
    if (e.type === "mousedown") e.preventDefault();
  }
  function onClick(e: MouseEvent): void {
    if (ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const el = e.target as Element;
    const multi = e.shiftKey || e.metaKey || e.ctrlKey || view.selection.length > 0;
    if (lastPointer !== "mouse" || multi) toggle(el);
    else finish([el]);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") finish(null);
    else if (e.key === "Enter" && view.selection.length > 0) finish(view.selection);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ---- Mode Area (sentuh): lapisan penuh layar dengan touch-action:none ----
  const elementAt = (x: number, y: number) =>
    document.elementsFromPoint(x, y).find((el) => el !== host && !host.contains(el)) ?? null;
  ui.layer.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, candidates: null };
    try {
      ui.layer.setPointerCapture(e.pointerId);
    } catch {
      // pointer sudah tidak aktif — drag tetap jalan tanpa capture
    }
  });
  ui.layer.addEventListener("pointermove", (e) => {
    dragMove(e.clientX, e.clientY);
  });
  ui.layer.addEventListener("pointerup", (e) => {
    if (dragEnd()) return;
    const el = elementAt(e.clientX, e.clientY);
    if (el) toggle(el);
  });
  ui.layer.addEventListener("pointercancel", () => {
    drag = null;
    view.area = null;
    view.preview = [];
    render();
  });

  const capture = { capture: true } as const;
  const listeners: Array<[string, EventListener]> = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerUp as EventListener],
    ["click", onClick as EventListener],
    ["keydown", onKey as EventListener],
    ...SWALLOWED.map((t) => [t, swallow] as [string, EventListener]),
  ];
  for (const [type, fn] of listeners) window.addEventListener(type, fn, capture);
  window.addEventListener("scroll", render, { capture: true, passive: true });
  window.addEventListener("resize", render);
  render();

  function finish(els: Element[] | null): void {
    for (const [type, fn] of listeners) window.removeEventListener(type, fn, capture);
    window.removeEventListener("scroll", render, { capture: true });
    window.removeEventListener("resize", render);
    clearTimeout(noticeTimer);
    for (const [k, v] of savedStyle) {
      if (v) docStyle.setProperty(k, v);
      else docStyle.removeProperty(k);
    }
    ui.destroy();
    if (els && els.length > 0) onPick([...els]);
    else onCancel();
  }
}
