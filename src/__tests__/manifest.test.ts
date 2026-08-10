/**
 * Unit test validitas PWA manifest (task 21.4, Requirement 8.1).
 *
 * Memverifikasi field wajib web app manifest (`name`, `short_name`,
 * `start_url`, `display`, `icons`) ada dan bernilai valid agar Client dapat
 * di-install sebagai Progressive Web App.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  description?: string;
  icons: ManifestIcon[];
}

function readManifest(): Manifest {
  const raw = readFileSync("public/manifest.json", "utf8");
  return JSON.parse(raw) as Manifest;
}

test("21.4: manifest.json adalah JSON valid", () => {
  expect(() => readManifest()).not.toThrow();
});

test("21.4: field wajib ada dan bernilai valid", () => {
  const manifest = readManifest();

  // name & short_name berupa string non-kosong
  expect(typeof manifest.name).toBe("string");
  expect(manifest.name.length).toBeGreaterThan(0);
  expect(typeof manifest.short_name).toBe("string");
  expect(manifest.short_name.length).toBeGreaterThan(0);

  // start_url adalah path/URL absolut valid
  expect(typeof manifest.start_url).toBe("string");
  expect(manifest.start_url.startsWith("/")).toBe(true);

  // display stand-alone (prasyarat instalasi PWA)
  expect(manifest.display).toBe("standalone");

  // icons: array non-kosong dengan src & type valid
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    expect(typeof icon.src).toBe("string");
    expect(icon.src.startsWith("/")).toBe(true);
    expect(typeof icon.type).toBe("string");
    expect(icon.type.length).toBeGreaterThan(0);
  }
});
