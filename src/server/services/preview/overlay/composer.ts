/**
 * Entry pesan satu baris membulat (lampirkan | teks | kirim) + lampiran
 * (thumbnail gambar, chip file & elemen terpilih) dan catatan error di
 * bawahnya. Konteks elemen ditambahkan ke akhir pesan saat dikirim. Pesan
 * hanya bisa dikirim saat Session berjalan.
 *
 * Isi composer = draf Session yang tersinkron dengan app (`draft-sync.ts`):
 * tiap ketikan / perubahan lampiran dikirim, perubahan dari app diterapkan.
 */
import { send } from "./api";
import { DEFAULT_ELEMENT_TEXT, DEFAULT_IMAGE_TEXT, MAX_ATTACHMENTS } from "./config";
import { h, iconButton, show, svg } from "./dom";
import { registerText, syncDraft } from "./draft-sync";
import { type ElementContext, pagesLabel } from "./element-context";
import { ICON } from "./icons";
import { canSend, notify, state } from "./state";
import type { CapturedError, OverlayAttachment } from "./types";

/** Tinggi maksimum textarea sebelum men-scroll (px). */
const MAX_INPUT_HEIGHT = 120;

export interface Composer {
  /** Entry (kartu) dan catatan error di bawahnya. */
  el: HTMLElement;
  note: HTMLElement;
  focus: () => void;
  /** Tambahkan error console sebagai blok kode ke pesan. */
  addError: (err: CapturedError) => void;
  /** Kolom pesan sedang fokus (dibawa melewati reload otomatis). */
  focused: () => boolean;
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
      !canSend() || state.sending || (textarea.value.trim() === "" && !hasAttachments());
  }
  textarea.addEventListener("input", () => {
    grow();
    syncDraft();
  });
  registerText(
    () => textarea.value,
    (text) => {
      textarea.value = text;
      grow();
    },
  );

  const hasAttachments = () => state.attachments.length > 0 || state.elements.length > 0;

  /** Teks pesan + blok konteks elemen terpilih. */
  function message(): string {
    const typed = textarea.value.trim();
    const text =
      typed ||
      (state.elements.length > 0 ? DEFAULT_ELEMENT_TEXT : "") ||
      (state.attachments.length > 0 ? DEFAULT_IMAGE_TEXT : "");
    return [text, ...state.elements.map((e) => e.context)].filter(Boolean).join("\n\n");
  }

  async function submit(): Promise<void> {
    const text = message();
    if (!text || state.sending) return;
    if (await send(text)) {
      textarea.value = "";
      grow();
      syncDraft();
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
    syncDraft();
    focus();
  }

  /** Gambar -> thumbnail; file lain (mis. dari app) -> chip nama file. */
  function attachment(item: OverlayAttachment): HTMLElement {
    const remove = h("button", { type: "button", "aria-label": `Remove ${item.name}` });
    remove.innerHTML = ICON.close;
    remove.addEventListener("click", () => {
      if (item.url) URL.revokeObjectURL(item.url);
      state.attachments = state.attachments.filter((a) => a !== item);
      notify();
    });
    if (!item.mime.startsWith("image/")) {
      return h(
        "div",
        { class: "chip", title: item.name },
        svg(ICON.file),
        h("span", {}, item.name),
        remove,
      );
    }
    const visual = item.url
      ? h("img", { src: item.url, alt: item.name })
      : h("span", { class: "spin", "aria-label": "Loading preview" });
    return h("div", { class: `thumb${item.url ? "" : " loading"}` }, visual, remove);
  }

  function chip(item: ElementContext): HTMLElement {
    const remove = h("button", { type: "button", "aria-label": "Remove element" });
    remove.innerHTML = ICON.close;
    remove.addEventListener("click", () => {
      state.elements = state.elements.filter((e) => e !== item);
      notify();
    });
    // Halaman ikut tampil agar elemen kembar dari halaman berbeda bisa dibedakan.
    const where = pagesLabel(item.pages);
    return h(
      "div",
      {
        class: `chip${state.flashKey === item.key ? " flash" : ""}`,
        title: item.pages.length > 1 ? `${item.pages.join("\n")}\n\n${item.context}` : item.context,
      },
      svg(ICON.code),
      h("span", {}, item.label),
      ...(where ? [h("small", {}, where)] : []),
      remove,
    );
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
    show(thumbs, hasAttachments());
    attachBtn.style.visibility = state.attachments.length >= MAX_ATTACHMENTS ? "hidden" : "";
    thumbs.replaceChildren(...state.elements.map(chip), ...state.attachments.map(attachment));
    show(note, state.sendError !== null);
    note.textContent = state.sendError ?? "";
    grow();
  }

  const focused = () => textarea.matches(":focus");

  return { el, note, focus, addError, focused, update };
}
