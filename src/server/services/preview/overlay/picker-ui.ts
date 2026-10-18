/**
 * Tampilan mode pilih elemen: kotak sorot (hover), kotak bernomor untuk
 * elemen terpilih, kotak seleksi saat drag, dan bar aksi.
 *
 * Bar ada di bawah (terjangkau jempol): di HP selebar layar dengan tombol
 * 40px dan toggle Tap | Area; di layar lebar berupa pill mengambang.
 * Murni tampilan — logika input ada di `picker.ts`.
 */
import { h } from "./dom";
import { shortName } from "./element-context";
import type { Box } from "./marquee";

export type PickMode = "tap" | "area";

export interface PickerView {
  hover: Element | null;
  selection: Element[];
  /** Elemen yang akan terpilih bila drag dilepas sekarang. */
  preview: Element[];
  area: Box | null;
  mode: PickMode;
  /** Perangkat sentuh: tampilkan toggle mode & teks untuk ketukan. */
  touch: boolean;
  max: number;
  notice: string | null;
}

export interface PickerUi {
  /** Lapisan penangkap drag untuk mode Area (sentuh). */
  layer: HTMLElement;
  render: (view: PickerView) => void;
  destroy: () => void;
}

const place = (
  el: HTMLElement,
  r: { left: number; top: number; width: number; height: number },
) => {
  el.style.cssText = `top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`;
};

function hintText(v: PickerView): string {
  if (v.notice) return v.notice;
  const n = v.selection.length;
  if (n > 0) return n >= v.max ? `${n} selected · limit reached` : `${n} selected`;
  if (!v.touch) return "Click an element · drag or ⇧-click for several";
  return v.mode === "area" ? "Drag over elements to select them" : "Tap elements to select them";
}

export function createPickerUi(
  root: HTMLElement,
  actions: { onMode: (m: PickMode) => void; onCancel: () => void; onAttach: () => void },
): PickerUi {
  const marks = h("div", { class: "pick-marks" });
  const hoverBox = h("div", { class: "pick-box hover" });
  const tag = h("div", { class: "pick-tag" });
  const area = h("div", { class: "pick-area" });
  const layer = h("div", { class: "pick-layer" });

  const hint = h("span", { class: "pick-hint" });
  const tapBtn = h("button", { type: "button" }, "Tap");
  const areaBtn = h("button", { type: "button" }, "Area");
  tapBtn.addEventListener("click", () => actions.onMode("tap"));
  areaBtn.addEventListener("click", () => actions.onMode("area"));
  const seg = h(
    "div",
    { class: "seg", role: "group", "aria-label": "Selection mode" },
    tapBtn,
    areaBtn,
  );
  const cancelBtn = h("button", { class: "pill", type: "button" }, "Cancel");
  cancelBtn.addEventListener("click", actions.onCancel);
  const count = h("span", { class: "pick-count" });
  const attachBtn = h("button", { class: "pill sugg", type: "button" }, "Attach", count);
  attachBtn.addEventListener("click", actions.onAttach);
  const bar = h("div", { class: "pick-bar", role: "toolbar" }, hint, seg, cancelBtn, attachBtn);
  root.append(layer, marks, hoverBox, tag, area, bar);

  function render(v: PickerView): void {
    // Pratinjau drag (garis putus) + kotak terpilih dengan nomor urut.
    marks.replaceChildren(
      ...v.preview
        .filter((el) => !v.selection.includes(el))
        .map((el) => {
          const box = h("div", { class: "pick-box pre" });
          place(box, el.getBoundingClientRect());
          return box;
        }),
      ...v.selection.flatMap((el, i) => {
        const r = el.getBoundingClientRect();
        const box = h("div", { class: "pick-box sel" });
        place(box, r);
        const num = h("div", { class: "pick-num" }, String(i + 1));
        num.style.cssText = `top:${Math.max(r.top - 9, 2)}px;left:${Math.max(r.left - 9, 2)}px`;
        return [box, num];
      }),
    );

    // Sorot elemen di bawah kursor / yang terakhir disentuh.
    // Elemen terpilih sudah punya kotak bernomor — sorotan cukup untuk yang belum.
    const hover = v.area || (v.hover && v.selection.includes(v.hover)) ? null : v.hover;
    hoverBox.style.display = tag.style.display = hover ? "" : "none";
    if (hover) {
      const r = hover.getBoundingClientRect();
      place(hoverBox, r);
      tag.textContent = `${shortName(hover)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
      // Label di atas kotak; pindah ke dalam bila mepet tepi atas.
      const top = r.top >= 26 ? r.top - 24 : r.top + 4;
      tag.style.cssText = `top:${Math.max(top, 4)}px;left:${Math.max(Math.min(r.left, innerWidth - 220), 4)}px`;
    }

    area.style.display = v.area ? "" : "none";
    if (v.area) {
      const b = v.area;
      place(area, { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top });
    }

    layer.classList.toggle("on", v.touch && v.mode === "area");
    seg.style.display = v.touch ? "" : "none";
    tapBtn.setAttribute("aria-pressed", String(v.mode === "tap"));
    areaBtn.setAttribute("aria-pressed", String(v.mode === "area"));
    hint.textContent = hintText(v);
    hint.classList.toggle("warn", v.notice !== null);
    const n = v.selection.length;
    count.textContent = n > 0 ? String(n) : "";
    count.style.display = n > 0 ? "" : "none";
    attachBtn.disabled = n === 0;
  }

  function destroy(): void {
    for (const el of [layer, marks, hoverBox, tag, area, bar]) el.remove();
  }

  return { layer, render, destroy };
}
