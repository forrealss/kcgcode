/**
 * Ringkasan elemen halaman untuk konteks pesan ke agent: selector CSS,
 * teks, atribut penting, tag pembuka, ukuran, dan — bila terdeteksi —
 * komponen framework beserta file sumbernya (React/Vue/Svelte mode dev).
 *
 * Nilai input tidak pernah diambil (bisa berisi data pribadi/sandi).
 *
 * Elemen yang sama (selector + tag pembuka sama) tidak dilampirkan dua kali:
 * di halaman yang sama dianggap duplikat; di halaman lain dianggap komponen
 * yang sama (header, navbar, CTA bersama) dan digabung jadi satu entri
 * dengan daftar halaman — lihat `addElement`.
 */

export interface ElementContext {
  /** Label pendek untuk chip, mis. `button.primary "Save"`. */
  label: string;
  /** Blok markdown yang ikut pesan. */
  context: string;
  /** Identitas elemen: selector + tag pembuka. */
  key: string;
  /** Halaman tempat elemen dipilih. */
  pages: string[];
}

const MAX_TEXT = 200;
const MAX_ATTR = 80;
const MAX_TAG = 400;
const SELECTOR_DEPTH = 6;
const KEY_ATTRS = [
  "href",
  "src",
  "alt",
  "title",
  "aria-label",
  "role",
  "type",
  "name",
  "placeholder",
  "data-testid",
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Kelas yang layak tampil di selector (lewati varian utilitas `hover:`/`[..]`). */
function usefulClasses(el: Element, max: number): string[] {
  return [...el.classList]
    .filter((c) => !/[:[\]/]/.test(c) && c.length <= 30)
    .slice(0, max)
    .map((c) => `.${CSS.escape(c)}`);
}

function uniqueId(el: Element): string | null {
  if (!el.id) return null;
  const sel = `#${CSS.escape(el.id)}`;
  try {
    return document.querySelectorAll(sel).length === 1 ? sel : null;
  } catch {
    return null;
  }
}

/** Selector CSS pendek dari elemen ke atas (berhenti di id unik). */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && parts.length < SELECTOR_DEPTH) {
    const id = uniqueId(node);
    if (id) {
      parts.unshift(id);
      break;
    }
    let part = node.tagName.toLowerCase() + usefulClasses(node, 2).join("");
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === node?.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

/** Nama singkat: `tag#id` atau `tag.kelas`. */
export function shortName(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  return tag + usefulClasses(el, 2).join("");
}

function visibleText(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return "";
  const text = el instanceof HTMLElement ? el.innerText : (el.textContent ?? "");
  return clip(squash(text ?? ""), MAX_TEXT);
}

function openingTag(el: Element): string {
  const attrs = [...el.attributes]
    .filter((a) => a.name !== "style" && a.name !== "value")
    .map((a) => (a.value ? `${a.name}="${clip(a.value, MAX_ATTR)}"` : a.name));
  const tag = el.tagName.toLowerCase();
  return clip(`<${[tag, ...attrs].join(" ")}>`, MAX_TAG);
}

/** Path sumber dipendekkan mulai dari `src/` bila ada. */
function shortPath(file: string): string {
  const i = file.lastIndexOf("/src/");
  return i >= 0 ? file.slice(i + 1) : file;
}

type Fiber = {
  type?: unknown;
  return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
};

function componentName(type: unknown): string | null {
  if (typeof type === "function") {
    const t = type as { displayName?: string; name?: string };
    return t.displayName || t.name || null;
  }
  if (type && typeof type === "object") {
    const t = type as { displayName?: string; render?: { name?: string }; type?: unknown };
    return t.displayName || t.render?.name || componentName(t.type);
  }
  return null;
}

/** Komponen terdekat (maks 3) + lokasi sumber, best-effort per framework. */
function frameworkInfo(el: Element): string | null {
  const any = el as unknown as Record<string, unknown>;

  // React: fiber tersimpan di properti `__reactFiber$<acak>`.
  const fiberKey = Object.keys(any).find((k) => k.startsWith("__reactFiber$"));
  if (fiberKey) {
    let fiber = any[fiberKey] as Fiber | null;
    const source = fiber?._debugSource;
    const names: string[] = [];
    let compSource = source;
    while (fiber && names.length < 3) {
      const name = typeof fiber.type === "string" ? null : componentName(fiber.type);
      if (name) {
        names.push(name);
        compSource ??= fiber._debugSource;
      }
      fiber = fiber.return ?? null;
    }
    const where = compSource?.fileName
      ? ` (${shortPath(compSource.fileName)}${compSource.lineNumber ? `:${compSource.lineNumber}` : ""})`
      : "";
    return names.length > 0 ? `${names.join(" ← ")}${where}` : null;
  }

  // Vue 3: instance komponen di `__vueParentComponent`.
  type VueInstance = {
    type?: { __name?: string; name?: string; __file?: string };
    parent?: VueInstance;
  };
  let vue = any.__vueParentComponent as VueInstance | undefined;
  if (vue) {
    const file = vue.type?.__file;
    const names: string[] = [];
    while (vue && names.length < 3) {
      const name = vue.type?.__name || vue.type?.name;
      if (name) names.push(name);
      vue = vue.parent;
    }
    const where = file ? ` (${shortPath(file)})` : "";
    return names.length > 0 ? `${names.join(" ← ")}${where}` : null;
  }

  // Svelte (dev): lokasi di `__svelte_meta`.
  const svelte = any.__svelte_meta as { loc?: { file?: string; line?: number } } | undefined;
  if (svelte?.loc?.file) {
    return `${shortPath(svelte.loc.file)}${svelte.loc.line ? `:${svelte.loc.line + 1}` : ""}`;
  }
  return null;
}

/**
 * Halaman saat ini: path + query, plus hash bila berbentuk route
 * (`#/pricing`, `#!/pricing`) — app ber-hash-router punya pathname sama
 * untuk semua halaman.
 */
export function currentPage(): string {
  const { pathname, search, hash } = location;
  const route = hash.startsWith("#/") || hash.startsWith("#!/") ? hash : "";
  return `${pathname}${search}${route}`;
}

function pageLine(pages: string[]): string {
  return pages.length === 1 ? `- page: ${pages[0]}` : `- pages: ${pages.join(", ")}`;
}

/** Keterangan halaman untuk chip: path tunggal, atau "N pages". */
export function pagesLabel(pages: string[]): string {
  return pages.length > 1 ? `${pages.length} pages` : (pages[0] ?? "");
}

export type AddResult = "added" | "merged" | "duplicate" | "full";

/**
 * Tambahkan elemen ke daftar lampiran (tanpa mengubah `list`):
 * - key baru -> entri baru (bila belum penuh);
 * - key sama, halaman sama -> duplikat, diabaikan;
 * - key sama, halaman lain -> halaman digabung ke entri yang ada.
 */
export function addElement(
  list: ElementContext[],
  item: ElementContext,
  max: number,
): { list: ElementContext[]; result: AddResult } {
  const i = list.findIndex((e) => e.key === item.key);
  if (i < 0) {
    if (list.length >= max) return { list, result: "full" };
    return { list: [...list, item], result: "added" };
  }
  const existing = list[i] as ElementContext;
  const extra = item.pages.filter((p) => !existing.pages.includes(p));
  if (extra.length === 0) return { list, result: "duplicate" };
  const pages = [...existing.pages, ...extra];
  const merged: ElementContext = {
    ...existing,
    pages,
    context: existing.context.replace(/^- pages?: .*$/m, pageLine(pages)),
  };
  return { list: list.map((e, j) => (j === i ? merged : e)), result: "merged" };
}

export function describeElement(el: Element): ElementContext {
  const name = shortName(el);
  const text = visibleText(el);
  const rect = el.getBoundingClientRect();
  const attrs = KEY_ATTRS.flatMap((a) => {
    const v = el.getAttribute(a);
    return v ? [`${a}="${clip(v, MAX_ATTR)}"`] : [];
  });
  const component = frameworkInfo(el);
  const selector = cssPath(el);
  const tag = openingTag(el);
  const page = currentPage();

  const lines = [
    `Selected element in the preview: \`${name}\``,
    pageLine([page]),
    `- selector: \`${selector}\``,
    ...(component ? [`- component: ${component}`] : []),
    ...(text ? [`- text: "${text}"`] : []),
    ...(attrs.length > 0 ? [`- attributes: ${attrs.join(" ")}`] : []),
    `- size: ${Math.round(rect.width)}×${Math.round(rect.height)}px`,
    `- html: \`${tag}\``,
  ];
  const label = text ? `${name} "${clip(text, 24)}"` : name;
  return { label, context: lines.join("\n"), key: `${selector}|${tag}`, pages: [page] };
}
