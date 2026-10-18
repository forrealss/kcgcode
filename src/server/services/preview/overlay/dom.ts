/** Helper DOM kecil + blok bangunan UI ala libadwaita (baris, grup, tombol toolbar). */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    // CSSOM, bukan atribut `style` (diblokir CSP tanpa 'unsafe-inline').
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

/** Ikon dalam pembungkus `.pre` (prefix baris). */
export function svg(icon: string): HTMLSpanElement {
  const s = h("span", { class: "pre" });
  s.innerHTML = icon;
  return s;
}

/** Tombol bundar datar berisi ikon. */
export function iconButton(icon: string, label: string, cls = "circ"): HTMLButtonElement {
  const b = h("button", { class: cls, type: "button", "aria-label": label });
  b.innerHTML = icon;
  return b;
}

/** Baris boxed list: ikon + judul (+ subjudul) + suffix. */
export function row(opts: {
  icon?: string;
  title: string | Node;
  subtitle?: string | Node;
  suffix?: Node;
  cls?: string;
}): HTMLElement {
  const el = h("div", { class: `row${opts.cls ? ` ${opts.cls}` : ""}` });
  if (opts.icon) el.append(svg(opts.icon));
  const txt = h("span", { class: "txt" }, h("span", { class: "t" }, opts.title));
  if (opts.subtitle !== undefined) txt.append(h("span", { class: "s" }, opts.subtitle));
  el.append(txt);
  if (opts.suffix) el.append(h("span", { class: "suf" }, opts.suffix));
  return el;
}

/** Grup (judul opsional) berisi boxed list. */
export function group(
  heading: string | null,
  ...rows: Node[]
): { el: HTMLElement; head: HTMLElement; list: HTMLElement } {
  const head = h("div", { class: "ghead" });
  if (heading) head.append(h("h3", {}, heading));
  const list = h("div", { class: "boxed" }, ...rows);
  const el = h("section", {}, ...(heading ? [head] : []), list);
  return { el, head, list };
}

/** Tombol datar toolbar: ikon di atas label. */
export function tool(
  icon: string,
  label: string,
  tag: "button" | "a" = "button",
): { el: HTMLElement; icon: HTMLSpanElement } {
  const el = h(tag, { class: "tool" });
  if (tag === "button") el.setAttribute("type", "button");
  const ic = h("span", { class: "ti" });
  ic.innerHTML = icon;
  el.append(ic, h("span", {}, label));
  return { el, icon: ic };
}

/** Switch GTK (checkbox ber-role switch). */
export function switchControl(checked: boolean, onChange: (on: boolean) => void): HTMLSpanElement {
  const input = h("input", { type: "checkbox", role: "switch" });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h("span", { class: "switch" }, input, h("span"));
}

/** Tampilkan / sembunyikan elemen. */
export function show(el: HTMLElement, visible: boolean): void {
  el.style.display = visible ? "" : "none";
}
