/**
 * Lampiran elemen overlay Preview (`overlay/element-context.ts`):
 * - elemen sama di halaman sama -> duplikat, diabaikan;
 * - elemen sama di halaman lain -> digabung (daftar halaman di konteks);
 * - batas jumlah entri; halaman = path + query + hash route.
 */
import { afterEach, expect, test } from "bun:test";
import {
  addElement,
  currentPage,
  type ElementContext,
  pagesLabel,
} from "../preview/overlay/element-context";

function element(page: string, key = '#cta|<button id="cta">'): ElementContext {
  return {
    label: 'button#cta "Get started"',
    key,
    pages: [page],
    context: [
      "Selected element in the preview: `button#cta`",
      `- page: ${page}`,
      "- selector: `#cta`",
      "- size: 102×40px",
    ].join("\n"),
  };
}

test("elemen baru ditambahkan", () => {
  const r = addElement([], element("/"), 8);
  expect(r.result).toBe("added");
  expect(r.list).toHaveLength(1);
});

test("elemen sama di halaman sama -> duplikat, daftar tidak berubah", () => {
  const list = [element("/")];
  const r = addElement(list, element("/"), 8);
  expect(r.result).toBe("duplicate");
  expect(r.list).toBe(list);
});

test("elemen sama di halaman lain -> digabung jadi satu entri dengan daftar halaman", () => {
  const first = addElement([], element("/"), 8).list;
  const r = addElement(first, element("/pricing"), 8);
  expect(r.result).toBe("merged");
  expect(r.list).toHaveLength(1);
  expect(r.list[0]?.pages).toEqual(["/", "/pricing"]);
  expect(r.list[0]?.context).toContain("- pages: /, /pricing");
  expect(r.list[0]?.context).not.toContain("- page: /\n");
  // Baris lain konteks tidak tersentuh.
  expect(r.list[0]?.context).toContain("- selector: `#cta`");
  // Halaman ketiga, lalu halaman yang sudah ada -> duplikat.
  const third = addElement(r.list, element("/about"), 8);
  expect(third.list[0]?.context).toContain("- pages: /, /pricing, /about");
  expect(addElement(third.list, element("/pricing"), 8).result).toBe("duplicate");
  // Daftar asal tidak dimutasi.
  expect(first[0]?.pages).toEqual(["/"]);
});

test("elemen berbeda tetap terpisah; batas jumlah entri", () => {
  const a = addElement([], element("/", "a"), 2).list;
  const b = addElement(a, element("/", "b"), 2).list;
  expect(b.map((e) => e.key)).toEqual(["a", "b"]);
  expect(addElement(b, element("/", "c"), 2).result).toBe("full");
  // Menggabung halaman tidak menambah entri, jadi tetap boleh saat penuh.
  expect(addElement(b, element("/x", "a"), 2).result).toBe("merged");
});

test("label halaman chip", () => {
  expect(pagesLabel(["/pricing"])).toBe("/pricing");
  expect(pagesLabel(["/", "/pricing"])).toBe("2 pages");
  expect(pagesLabel([])).toBe("");
});

const realLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
afterEach(() => {
  if (realLocation) Object.defineProperty(globalThis, "location", realLocation);
  else delete (globalThis as { location?: unknown }).location;
});

function setLocation(pathname: string, search: string, hash: string): void {
  Object.defineProperty(globalThis, "location", {
    value: { pathname, search, hash },
    configurable: true,
  });
}

test("halaman: path + query; hash ikut bila berbentuk route", () => {
  setLocation("/shop", "?q=1", "#reviews");
  expect(currentPage()).toBe("/shop?q=1");
  setLocation("/", "", "#/pricing");
  expect(currentPage()).toBe("/#/pricing");
  setLocation("/", "", "#!/about");
  expect(currentPage()).toBe("/#!/about");
});
