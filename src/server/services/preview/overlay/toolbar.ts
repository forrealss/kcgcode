/**
 * Toolbar sheet: tombol datar ikon + label (Reload, Screenshot, Desktop,
 * Chat, Hide). Desktop adalah toggle (GTK toggle button); Chat diberi titik
 * merah saat agent menunggu jawaban.
 */
import { h, show, tool } from "./dom";
import { ICON } from "./icons";
import { notify, state } from "./state";
import { isDesktop, setDesktop } from "./viewport";

export function createToolbar(onScreenshot: () => void): {
  el: HTMLElement;
  update: () => void;
} {
  const reload = tool(ICON.reload, "Reload");
  reload.el.addEventListener("click", () => location.reload());

  const shot = tool(ICON.camera, "Screenshot");
  shot.el.title = "Mark up a screenshot and attach it";
  shot.el.addEventListener("click", onScreenshot);

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

  const hide = tool(ICON.hide, "Hide");
  hide.el.title = "Hide the button until the page reloads";
  hide.el.addEventListener("click", () => {
    state.hidden = true;
    state.open = false;
    notify();
  });

  const el = h("div", { class: "tools" }, reload.el, shot.el, view.el, chat.el, hide.el);

  function update(): void {
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
