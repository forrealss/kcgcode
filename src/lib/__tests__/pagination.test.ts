import { expect, test } from "bun:test";
import { paginate } from "@/lib/pagination";

const items = [1, 2, 3, 4, 5, 6, 7];

test("paginate: potong per halaman dengan rentang 1-based", () => {
  expect(paginate(items, 0, 3)).toEqual({
    items: [1, 2, 3],
    page: 0,
    pageCount: 3,
    from: 1,
    to: 3,
    total: 7,
  });
  expect(paginate(items, 2, 3)).toMatchObject({ items: [7], page: 2, from: 7, to: 7 });
});

test("paginate: halaman di luar rentang dijepit", () => {
  expect(paginate(items, 9, 3)).toMatchObject({ items: [7], page: 2 });
  expect(paginate(items, -1, 3)).toMatchObject({ items: [1, 2, 3], page: 0 });
});

test("paginate: daftar kosong = satu halaman kosong", () => {
  expect(paginate([], 4, 3)).toEqual({
    items: [],
    page: 0,
    pageCount: 1,
    from: 0,
    to: 0,
    total: 0,
  });
});
