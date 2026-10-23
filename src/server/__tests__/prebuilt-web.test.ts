import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPrebuiltWeb } from "../prebuilt-web";

describe("loadPrebuiltWeb", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("null bila belum di-build", () => {
    dir = mkdtempSync(path.join(tmpdir(), "kcg-web-"));
    expect(loadPrebuiltWeb(dir)).toBeNull();
  });

  test("shell SPA + rute chunk; sourcemap tidak diekspos", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kcg-web-"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    writeFileSync(path.join(dir, "chunk-abc123.js"), "console.log(1)");
    writeFileSync(path.join(dir, "chunk-abc123.js.map"), "{}");
    mkdirSync(path.join(dir, "icons"));
    writeFileSync(path.join(dir, "icons", "a.png"), "png");

    const web = loadPrebuiltWeb(dir);
    expect(web).not.toBeNull();
    if (!web) return;
    expect(Object.keys(web.assets).sort()).toEqual(["/chunk-abc123.js", "/icons/a.png"]);
    expect(web.spa.headers.get("content-type")).toContain("text/html");

    const chunk = web.assets["/chunk-abc123.js"]?.() as Response;
    expect(await chunk.text()).toBe("console.log(1)");
    expect(chunk.headers.get("cache-control")).toContain("immutable");
    expect(web.assets["/icons/a.png"]?.().headers.get("cache-control")).toBe("no-cache");
    expect(chunk.headers.get("content-type")).toContain("javascript");
  });

  test("chunk dibaca saat start: tetap tersaji setelah paket di disk diganti", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kcg-web-"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html>");
    writeFileSync(path.join(dir, "chunk-old111.js"), "old");
    const web = loadPrebuiltWeb(dir);
    // Update paket: chunk lama dihapus, chunk baru ditulis.
    rmSync(path.join(dir, "chunk-old111.js"));
    writeFileSync(path.join(dir, "chunk-new222.js"), "new");

    const serve = web?.assets["/chunk-old111.js"];
    if (!serve) throw new Error("chunk route missing");
    expect(await serve().text()).toBe("old");
    // Response bisa dibuat berulang (body tidak terpakai habis).
    expect(await serve().text()).toBe("old");
  });
});
