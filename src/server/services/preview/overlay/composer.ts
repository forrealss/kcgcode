/**
 * Entry pesan satu baris membulat (lampirkan | teks | kirim) + thumbnail
 * gambar terlampir dan catatan error di bawahnya. Pesan hanya bisa dikirim
 * saat Session berjalan.
 */
import { send } from "./api";
import { DEFAULT_IMAGE_TEXT, MAX_IMAGES } from "./config";
import { h, iconButton, show } from "./dom";
import { ICON } from "./icons";
import { canSend, notify, state } from "./state";
import type { CapturedError } from "./types";

/** Tinggi maksimum textarea sebelum men-scroll (px). */
const MAX_INPUT_HEIGHT = 120;

export interface Composer {
  /** Entry (kartu) dan catatan error di bawahnya. */
  el: HTMLElement;
  note: HTMLElement;
  focus: () => void;
  /** Tambahkan error console sebagai blok kode ke pesan. */
  addError: (err: CapturedError) => void;
  update: () => void;
}

export function createComposer(onPhoto: (file: File) => void): Composer {
  const textarea = h("textarea", {
    rows: "1",
    placeholder: "Tell the agent what to change…",
    "aria-label": "Message to the agent",
  });
  const sendBtn = iconButton(ICON.send, "Send", "send");
  // Foto dari perangkat (mis. screenshot OS yang persis seperti di layar).
  const fileInput = h("input", { type: "file", accept: "image/*", style: "display:none" });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) onPhoto(file);
  });
  const attachBtn = iconButton(ICON.image, "Add a photo");
  attachBtn.addEventListener("click", () => fileInput.click());
  const thumbs = h("div", { class: "thumbs" });
  const el = h(
    "div",
    { class: "entry" },
    thumbs,
    h("div", { class: "entrybar" }, attachBtn, textarea, sendBtn),
    fileInput,
  );
  const note = h("div", { class: "note", role: "alert" });

  function grow(): void {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    sendBtn.disabled =
      !canSend() || state.sending || (textarea.value.trim() === "" && state.images.length === 0);
  }
  textarea.addEventListener("input", grow);

  async function submit(): Promise<void> {
    const text = textarea.value.trim() || (state.images.length > 0 ? DEFAULT_IMAGE_TEXT : "");
    if (!text || state.sending) return;
    if (await send(text)) {
      textarea.value = "";
      grow();
    }
  }
  sendBtn.addEventListener("click", () => void submit());
  textarea.addEventListener("keydown", (e) => {
    // Enter mengirim di keyboard fisik; di HP Enter tetap baris baru.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.isComposing &&
      matchMedia("(pointer:fine)").matches
    ) {
      e.preventDefault();
      void submit();
    }
  });

  const focus = () => textarea.focus({ preventScroll: true });

  function addError(err: CapturedError): void {
    const where = location.pathname + location.search;
    const lines = [err.message, ...err.detail.split("\n").slice(0, 12)].filter(Boolean);
    const block = `Error in the preview (${where}):\n\`\`\`\n${lines.join("\n")}\n\`\`\``;
    const current = textarea.value.trim();
    textarea.value = current ? `${current}\n\n${block}` : block;
    grow();
    focus();
  }

  function thumb(img: { id: string; url: string }): HTMLElement {
    const remove = h("button", { type: "button", "aria-label": "Remove image" });
    remove.innerHTML = ICON.close;
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(img.url);
      state.images = state.images.filter((i) => i !== img);
      notify();
    });
    return h("div", { class: "thumb" }, h("img", { src: img.url, alt: "" }), remove);
  }

  function update(): void {
    const running = canSend();
    show(el, state.session !== null);
    el.classList.toggle("off", !running);
    textarea.disabled = !running;
    attachBtn.disabled = !running;
    textarea.placeholder = running
      ? "Tell the agent what to change…"
      : "Start the session from the chat to send";
    show(thumbs, state.images.length > 0);
    attachBtn.style.visibility = state.images.length >= MAX_IMAGES ? "hidden" : "";
    thumbs.replaceChildren(...state.images.map(thumb));
    show(note, state.sendError !== null);
    note.textContent = state.sendError ?? "";
    grow();
  }

  return { el, note, focus, addError, update };
}
