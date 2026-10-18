/**
 * Layar penuh untuk mencoret-coret gambar (screenshot / foto) sebelum
 * dilampirkan ke pesan. Hasilnya diunggah sebagai JPEG dan masuk
 * `state.attachments` (dan draf Session yang tersinkron).
 */
import { uploadImage } from "./api";
import { h, iconButton } from "./dom";
import { ICON } from "./icons";
import { notify, state } from "./state";

/** Sisi terpanjang gambar yang diunggah (px) — agar unggahan tetap kecil. */
const MAX_SIDE = 1600;
const STROKE = "#e01b24";

type Stroke = Array<[number, number]>;

export function openAnnotator(root: HTMLElement, src: Blob, onAttached: () => void): void {
  const url = URL.createObjectURL(src);
  const img = new Image();
  img.onload = () => mountAnnotator(root, img, url, onAttached);
  img.onerror = () => {
    URL.revokeObjectURL(url);
    state.sendError = "That image couldn't be opened.";
    notify();
  };
  img.src = url;
}

function mountAnnotator(
  root: HTMLElement,
  img: HTMLImageElement,
  url: string,
  onAttached: () => void,
): void {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = h("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const strokes: Stroke[] = [];
  const lineWidth = Math.max(4, Math.round(canvas.width / 120));

  const undoBtn = iconButton(ICON.undo, "Undo");
  undoBtn.addEventListener("click", () => {
    strokes.pop();
    draw();
  });

  function draw(): void {
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      ctx.beginPath();
      for (const [i, [x, y]] of s.entries()) {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Ketukan tunggal tetap menghasilkan titik.
      if (s.length === 1 && s[0]) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
      ctx.stroke();
    }
    undoBtn.disabled = strokes.length === 0;
  }

  const pointAt = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * canvas.width,
      ((e.clientY - r.top) / r.height) * canvas.height,
    ];
  };
  let drawing = false;
  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    strokes.push([pointAt(e)]);
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    strokes[strokes.length - 1]?.push(pointAt(e));
    draw();
  });
  const end = () => {
    drawing = false;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  const done = () => {
    URL.revokeObjectURL(url);
    panel.remove();
    state.annotating = false;
    state.open = true;
    notify();
  };
  const cancelBtn = h("button", { type: "button", class: "pillbtn" }, "Cancel");
  cancelBtn.addEventListener("click", done);
  const attachBtn = h("button", { type: "button", class: "pillbtn sugg" }, "Attach");
  attachBtn.addEventListener("click", () => {
    attachBtn.disabled = true;
    attachBtn.textContent = "Attaching…";
    canvas.toBlob(
      async (blob) => {
        if (!blob) return done();
        try {
          const id = await uploadImage(blob);
          state.attachments.push({
            id,
            name: "screenshot.jpg",
            mime: "image/jpeg",
            size: blob.size,
            url: URL.createObjectURL(blob),
          });
          state.sendError = null;
        } catch {
          state.sendError = "Couldn't attach the image.";
        }
        done();
        onAttached();
      },
      "image/jpeg",
      0.85,
    );
  });

  const panel = h(
    "div",
    { class: "annot", role: "dialog", "aria-label": "Mark up the screenshot" },
    h(
      "div",
      { class: "headerbar" },
      cancelBtn,
      h("div", { class: "title" }, h("b", {}, "Mark Up")),
      h("div", { class: "end" }, undoBtn, attachBtn),
    ),
    h("div", { class: "stage" }, canvas),
    h("div", { class: "foot" }, "Draw on the image to point at what to change."),
  );
  root.append(panel);
  state.annotating = true;
  state.open = false;
  notify();
  draw();
}
