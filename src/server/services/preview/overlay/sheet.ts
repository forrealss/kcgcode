/**
 * Sheet overlay (bottom sheet ala AdwDialog; mengambang di layar lebar):
 * header bar (judul Session + status), toolbar, balasan terakhir agent,
 * error console, composer, dan switch reload otomatis.
 */

import { openAnnotator } from "./annotator";
import { captureScreenshot } from "./api";
import { createComposer } from "./composer";
import { group, h, iconButton, row, show, switchControl } from "./dom";
import { createErrorsGroup } from "./errors-group";
import { ICON } from "./icons";
import { notify, setAutoReload, state } from "./state";
import { sessionStatus } from "./status";
import { createToolbar } from "./toolbar";

export interface Sheet {
  update: () => void;
  focusInput: () => void;
}

export function createSheet(root: HTMLElement): Sheet {
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
  const toolbar = createToolbar(() => void markUpScreenshot());
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

  function update(): void {
    if (!state.open) {
      scrim.remove();
      sheet.remove();
      return;
    }
    if (!sheet.isConnected) root.append(scrim, sheet);
    const hasSession = state.session !== null;
    updateHeader();
    toolbar.update();
    updateAgent();
    errorsGroup.update();
    composer.update();
    show(autoReload, hasSession);
    show(noSession, !hasSession);
  }

  return { update, focusInput: composer.focus };
}
