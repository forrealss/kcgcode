/**
 * Sheet overlay (bottom sheet ala AdwDialog; mengambang di layar lebar):
 * header bar (judul Session + status), toolbar, balasan terakhir agent,
 * error console, composer, dan switch reload otomatis.
 */

import { openAnnotator } from "./annotator";
import { captureScreenshot } from "./api";
import { createComposer } from "./composer";
import { MAX_ELEMENTS } from "./config";
import { group, h, iconButton, row, show, switchControl } from "./dom";
import { addElement, describeElement } from "./element-context";
import { createErrorsGroup } from "./errors-group";
import { ICON } from "./icons";
import { startPicker } from "./picker";
import { notify, setAutoReload, state } from "./state";
import { sessionStatus } from "./status";
import { createToolbar } from "./toolbar";

export interface Sheet {
  update: () => void;
  focusInput: () => void;
  inputFocused: () => boolean;
  /** Posisi scroll isi sheet. */
  scroll: () => number;
  setScroll: (top: number) => void;
  /** Pembukaan berikutnya tanpa animasi (pulih dari reload otomatis). */
  skipEnterAnimation: () => void;
}

/** Lama sorotan chip elemen yang dipilih ulang / digabung (ms). */
const FLASH_MS = 1600;
/** Durasi animasi tutup terpanjang (ms) — sesuai `sheet-out` di styles.ts. */
const CLOSE_MS = 220;

/**
 * @param anchor tombol OSD — di layar lebar sheet "tumbuh" dari posisinya.
 */
export function createSheet(root: HTMLElement, anchor: () => Element | null): Sheet {
  const close = () => {
    state.open = false;
    notify();
  };
  const scrim = h("div", { class: "scrim" });
  scrim.addEventListener("click", close);
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-label": "KCG Code preview" });
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Header bar: (ruang seimbang) | judul + status | tutup.
  const title = h("b");
  const subtitle = h("span");
  const closeBtn = iconButton(ICON.close, "Close", "circ tinted");
  closeBtn.addEventListener("click", close);
  const headerbar = h(
    "div",
    { class: "headerbar" },
    h("span"),
    h("div", { class: "title" }, title, subtitle),
    closeBtn,
  );

  const annotate = (src: Blob) => openAnnotator(root, src, () => setTimeout(composer.focus, 50));
  const composer = createComposer(annotate);
  const toolbar = createToolbar({
    onSelect: pickElement,
    onScreenshot: () => void markUpScreenshot(),
  });
  const errorsGroup = createErrorsGroup(composer.addError);

  // Balasan terakhir & error agent (ketuk balasan untuk membuka penuh).
  // Status agent ada di subjudul header, jadi grup ini hanya muncul bila ada isinya.
  const replyText = h("span", { class: "clamp" });
  replyText.addEventListener("click", () => replyText.classList.toggle("full"));
  const replyBox = h("div", { class: "reply" }, h("small", {}, "Last reply"), replyText);
  const agentErr = row({ icon: ICON.warn, title: "", cls: "err" });
  const agentGroup = group(null, replyBox, agentErr);

  // Switch row: reload otomatis saat agent selesai (AdwSwitchRow).
  const autoReload = h(
    "label",
    { class: "boxed", title: "For changes hot reload doesn't pick up" },
    row({
      title: "Reload when the agent finishes",
      suffix: switchControl(state.autoReload, setAutoReload),
    }),
  );

  const noSession = h("p", { class: "hint" });
  noSession.textContent = "Open the preview from a chat to message the agent here.";

  const body = h(
    "div",
    { class: "body" },
    toolbar.el,
    agentGroup.el,
    errorsGroup.el,
    composer.el,
    composer.note,
    autoReload,
    noSession,
  );
  sheet.append(h("div", { class: "grab" }), headerbar, body);

  /** Sorot chip elemen sebentar (sudah terlampir / halaman baru digabung). */
  function flashChip(key: string): void {
    state.flashKey = key;
    setTimeout(() => {
      if (state.flashKey !== key) return;
      state.flashKey = null;
      notify();
    }, FLASH_MS);
  }

  /** Tutup sheet, pilih elemen (satu / banyak) di halaman, lalu lampirkan ke pesan. */
  function pickElement(): void {
    state.open = false;
    state.picking = true;
    notify();
    const back = () => {
      state.picking = false;
      state.open = true;
      notify();
    };
    startPicker(root, {
      max: MAX_ELEMENTS - state.elements.length,
      onPick: (els) => {
        // Elemen yang sudah terlampir: halaman sama -> diabaikan; halaman
        // lain -> digabung. Chip-nya disorot agar pengguna tahu ke mana perginya.
        let flash: string | null = null;
        for (const el of els) {
          const item = describeElement(el);
          const added = addElement(state.elements, item, MAX_ELEMENTS);
          state.elements = added.list;
          if (added.result === "duplicate" || added.result === "merged") flash = item.key;
        }
        if (flash) flashChip(flash);
        back();
        setTimeout(composer.focus, 50);
      },
      onCancel: back,
    });
  }

  async function markUpScreenshot(): Promise<void> {
    if (state.shooting) return;
    if (!state.screenshots) {
      state.sendError =
        "Screenshots need Chrome on the computer running KCG Code. Add a photo instead.";
      notify();
      return;
    }
    state.shooting = true;
    state.sendError = null;
    notify();
    try {
      annotate(await captureScreenshot());
    } catch {
      state.sendError = "Couldn't take a screenshot. Add a photo instead.";
    } finally {
      state.shooting = false;
      notify();
    }
  }

  function updateHeader(): void {
    title.textContent = state.session?.title || "Preview";
    // Titik berwarna + teks (bukan warna saja).
    const { tone, label } = sessionStatus();
    subtitle.replaceChildren(
      ...(state.session ? [h("i", { class: `sd ${tone}`, "aria-hidden": "true" })] : []),
      label,
    );
  }

  function updateAgent(): void {
    if (replyText.textContent !== (state.reply ?? "")) {
      replyText.textContent = state.reply ?? "";
      replyText.classList.remove("full");
    }
    show(replyBox, state.reply !== null);
    show(agentErr, state.agentError !== null);
    const errTitle = agentErr.querySelector(".t");
    if (errTitle) errTitle.textContent = state.agentError ?? "";
    show(
      agentGroup.el,
      state.session !== null && (state.reply !== null || state.agentError !== null),
    );
  }

  // ---- Buka / tutup beranimasi ----
  let closeTimer = 0;
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  let instantEnter = false;

  function enter(): void {
    // Dibuka lagi saat animasi tutup belum selesai: batalkan tutupnya.
    clearTimeout(closeTimer);
    scrim.classList.remove("closing");
    sheet.classList.remove("closing");
    if (sheet.isConnected) return;
    // `no-anim` dibiarkan sampai sheet ditutup: melepasnya lebih awal justru
    // memulai animasi buka dari awal.
    scrim.classList.toggle("no-anim", instantEnter);
    sheet.classList.toggle("no-anim", instantEnter);
    instantEnter = false;
    root.append(scrim, sheet);
    // Titik asal animasi = pusat tombol OSD (hanya terlihat di layar lebar).
    const from = anchor()?.getBoundingClientRect();
    if (from) {
      const box = sheet.getBoundingClientRect();
      const x = from.left + from.width / 2 - box.left;
      const y = from.top + from.height / 2 - box.top;
      sheet.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`;
    }
  }

  function leave(): void {
    if (!sheet.isConnected || sheet.classList.contains("closing")) return;
    scrim.classList.remove("no-anim");
    sheet.classList.remove("no-anim");
    const done = () => {
      scrim.remove();
      sheet.remove();
      scrim.classList.remove("closing");
      sheet.classList.remove("closing");
    };
    if (reducedMotion()) {
      done();
      return;
    }
    scrim.classList.add("closing");
    sheet.classList.add("closing");
    closeTimer = window.setTimeout(done, CLOSE_MS);
  }

  function update(): void {
    if (!state.open) {
      leave();
      return;
    }
    enter();
    const hasSession = state.session !== null;
    updateHeader();
    toolbar.update();
    updateAgent();
    errorsGroup.update();
    composer.update();
    show(autoReload, hasSession);
    show(noSession, !hasSession);
  }

  return {
    update,
    focusInput: composer.focus,
    inputFocused: composer.focused,
    scroll: () => body.scrollTop,
    setScroll: (top) => {
      body.scrollTop = top;
    },
    skipEnterAnimation: () => {
      instantEnter = true;
    },
  };
}
