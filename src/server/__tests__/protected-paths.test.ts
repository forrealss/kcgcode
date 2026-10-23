/**
 * Unit test daftar path terlindungi (src/server/bootstrap/api-routes.ts):
 * satu sumber untuk validasi workspace (folder) dan viewer file (file).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { resolveTurnDiffsDir } from "../../paths";
import { protectedPaths } from "../bootstrap/api-routes";

const prevDb = process.env.KCG_DB_PATH;
beforeEach(() => {
  process.env.KCG_DB_PATH = "/srv/kcg/data/kcg.sqlite";
});
afterEach(() => {
  if (prevDb === undefined) delete process.env.KCG_DB_PATH;
  else process.env.KCG_DB_PATH = prevDb;
});

test("resolveTurnDiffsDir: turn-diffs di samping folder uploads", () => {
  expect(resolveTurnDiffsDir("/srv/kcg/data/uploads")).toBe(
    path.join("/srv/kcg/data", "turn-diffs"),
  );
});

test("folder untuk workspace, file spesifik untuk viewer — dari path yang sama", () => {
  const p = protectedPaths("/etc/kcg/config.json", "/srv/kcg/up/uploads");
  expect(p.dirs).toEqual([
    "/srv/kcg/data",
    "/srv/kcg/up/uploads",
    path.join("/srv/kcg/up", "turn-diffs"),
    "/etc/kcg",
  ]);
  expect(p.files).toEqual([
    "/srv/kcg/data/kcg.sqlite",
    "/srv/kcg/data/kcg.sqlite-wal",
    "/srv/kcg/data/kcg.sqlite-shm",
    "/srv/kcg/up/uploads",
    path.join("/srv/kcg/up", "turn-diffs"),
    path.join("/srv/kcg/data", "frpc.toml"),
    "/etc/kcg/config.json",
  ]);
});
