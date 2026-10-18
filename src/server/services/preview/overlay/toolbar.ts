/**
 * Toolbar sheet: tombol datar ikon + label (Select, Screenshot, Desktop,
 * Chat). Desktop adalah toggle (GTK toggle button); Chat diberi titik merah
 * saat agent menunggu jawaban. Reload sengaja tidak ada (cukup refresh
 * browser); tombol melayang yang menghalangi cukup digeser ke tepi lain.
 */

import { MAX_ELEMENTS } from "./config";
import { h, show, tool } from "./dom";
import { ICON } from "./icons";
import { notify, state } from "./state";
import { isDesktop, setDesktop } from "./viewport";

export function createToolbar(actions: { onSelect: () => void; onScreenshot: () => void }): {
  el: HTMLElement;
  update: () => void;
} {
  const select = tool(ICON.select, "Select");
  select.el.title = "Pick an element on the page and attach it";
  select.el.addEventListener("click", actions.onSelect);

  const shot = tool(ICON.camera, "Screenshot");
  shot.el.title = "Mark up a screenshot and attach it";
  shot.el.addEventListener("click", actions.onScreenshot);

  const view = tool(ICON.desktop, "Desktop");
  view.el.title = "Render the page at desktop width";
  view.el.addEventListener("click", () => {
    setDesktop(!isDesktop());
    notify();
  });

  const chat = tool(ICON.chat, "Chat", "a");
  chat.el.title = "Open this session in KCG Code";
  chat.el.setAttribute("target", "_top");
  const chatPip = h("span", { class: "pip" });
  chat.icon.append(chatPip);

  const el = h("div", { class: "tools" }, select.el, shot.el, view.el, chat.el);

  function update(): void {
    show(select.el, state.session !== null);
    (select.el as HTMLButtonElement).disabled = state.elements.length >= MAX_ELEMENTS;
    show(shot.el, state.session !== null);
    (shot.el as HTMLButtonElement).disabled = state.shooting;
    shot.icon.innerHTML = state.shooting ? '<span class="spin"></span>' : ICON.camera;
    view.el.setAttribute("aria-pressed", String(isDesktop()));
    show(chat.el, state.chatUrl !== null);
    if (state.chatUrl) chat.el.setAttribute("href", state.chatUrl);
    show(chatPip, state.attention);
  }

  return { el, update };
}
