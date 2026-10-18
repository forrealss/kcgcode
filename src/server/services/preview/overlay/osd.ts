/**
 * Tombol OSD melayang: bisa digeser, menempel ke tepi kiri/kanan terdekat
 * (posisinya diingat), dengan titik status agent & jumlah error console.
 */
import { PILL_KEY } from "./config";
import { h } from "./dom";
import { ICON } from "./icons";
import { errors, state } from "./state";
import { local, store } from "./storage";

/** Setengah ukuran tombol (px) — titik pegang saat digeser. */
const HALF = 24;
const EDGE = 12;
/** Jarak geser minimum sebelum dianggap drag, bukan ketukan. */
const DRAG_SLOP = 8;

type Position = { side: "left" | "right"; top: number };

function savedPosition(): Position {
  try {
    const saved = JSON.parse(store.get(local, PILL_KEY) ?? "null") as Position | null;
    if (saved && (saved.side === "left" || saved.side === "right") && Number.isFinite(saved.top)) {
      return saved;
    }
  } catch {
    // posisi default
  }
  return { side: "right", top: Math.round(window.innerHeight * 0.7) };
}

export function createOsd(onOpen: () => void): { el: HTMLElement; update: () => void } {
  const pill = h("button", { class: "osd", type: "button", "aria-label": "KCG Code preview" });
  const logo = h("span", { class: "logo" });
  logo.innerHTML = ICON.logo;
  const dot = h("span", { class: "dot" });
  const badge = h("span", { class: "badge" });
  pill.append(logo, dot, badge);

  let pos = savedPosition();
  function place(): void {
    const top = Math.min(Math.max(pos.top, EDGE), window.innerHeight - 60);
    pill.style.top = `${top}px`;
    pill.style.left = pos.side === "left" ? `${EDGE}px` : "";
    pill.style.right = pos.side === "right" ? `${EDGE}px` : "";
  }
  place();
  window.addEventListener("resize", place);

  let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
  pill.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    pill.setPointerCapture(e.pointerId);
  });
  pill.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_SLOP) return;
    drag.moved = true;
    pill.classList.add("dragging");
    pill.style.right = "";
    pill.style.left = `${e.clientX - HALF}px`;
    pill.style.top = `${e.clientY - HALF}px`;
  });
  pill.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    pill.classList.remove("dragging");
    if (!moved) return onOpen();
    // Menempel ke tepi terdekat; posisi diingat untuk halaman berikutnya.
    pos = { side: e.clientX < window.innerWidth / 2 ? "left" : "right", top: e.clientY - HALF };
    store.set(local, PILL_KEY, JSON.stringify(pos));
    place();
  });
  pill.addEventListener("pointercancel", () => {
    drag = null;
    pill.classList.remove("dragging");
    place();
  });

  function update(): void {
    pill.style.display = state.hidden || state.open || state.annotating ? "none" : "flex";
    dot.style.display = state.attention || state.turnActive ? "" : "none";
    dot.className = state.attention ? "dot attn" : "dot";
    const total = errors.reduce((n, e) => n + e.count, 0);
    badge.style.display = total > 0 ? "" : "none";
    badge.textContent = total > 99 ? "99+" : String(total);
  }

  return { el: pill, update };
}
