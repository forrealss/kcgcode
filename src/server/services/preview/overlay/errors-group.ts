/** Grup "Console errors": error terbaru di atas, bisa ditambahkan ke pesan. */
import { group, h, iconButton, row, show } from "./dom";
import { ICON } from "./icons";
import { clearErrors, errors, state } from "./state";
import type { CapturedError } from "./types";

export function createErrorsGroup(onAdd: (err: CapturedError) => void): {
  el: HTMLElement;
  update: () => void;
} {
  const { el, head, list } = group("Console errors");
  const count = h("span", { class: "count" });
  head.querySelector("h3")?.append(count);
  const clearBtn = h("button", { class: "flat", type: "button" }, "Clear");
  clearBtn.addEventListener("click", clearErrors);
  head.append(clearBtn);

  function errorRow(err: CapturedError, canAdd: boolean): HTMLElement {
    let suffix: HTMLButtonElement | undefined;
    if (canAdd) {
      suffix = iconButton(ICON.plus, "Add to message");
      suffix.title = "Add to message";
      suffix.addEventListener("click", () => onAdd(err));
    }
    return row({
      icon: ICON.warn,
      title: h("span", { class: "mono clamp" }, err.message),
      subtitle: err.count > 1 ? `Happened ${err.count} times` : undefined,
      suffix,
      cls: "err",
    });
  }

  function update(): void {
    show(el, errors.length > 0);
    count.textContent = String(errors.length);
    const canAdd = state.session !== null;
    list.replaceChildren(...[...errors].reverse().map((err) => errorRow(err, canAdd)));
  }

  return { el, update };
}
