import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setRunMode } from "../../../runtime";
import {
  createUpdateChecker,
  fetchLatestVersion,
  isUpdateInstalled,
  isValidVersion,
  readUpdateCache,
  registryUrl,
  resolveUpdate,
  updateCheckEnabled,
} from "../update-check";

const PKG = { name: "kcg-code", version: "0.3.0" };
const tmpDirs: string[] = [];

function tmpCache(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kcg-update-"));
  tmpDirs.push(dir);
  return path.join(dir, "update-check.json");
}

/** Fetch palsu: catat URL, balas `{ version }` (atau lempar / status error). */
function fakeRegistry(reply: { version?: unknown; status?: number; throws?: boolean }) {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(String(url));
    if (reply.throws) throw new TypeError("network down");
    return new Response(JSON.stringify({ version: reply.version }), {
      status: reply.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

function checker(fetchFn: typeof fetch, cachePath = tmpCache()) {
  return createUpdateChecker({
    enabled: true,
    fetch: fetchFn,
    registry: "https://registry.example.test",
    cachePath,
    readPackage: async () => PKG,
    now: () => 1000,
  });
}

afterEach(() => {
  setRunMode("dev");
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveUpdate", () => {
  test("hanya versi yang lebih baru dianggap update", () => {
    expect(resolveUpdate(PKG, "0.4.0")).toEqual({
      current: "0.3.0",
      latest: "0.4.0",
      command: "bun i -g kcg-code@latest",
    });
    expect(resolveUpdate(PKG, "0.3.1")?.latest).toBe("0.3.1");
    expect(resolveUpdate(PKG, "0.3.0")).toBeNull();
    expect(resolveUpdate(PKG, "0.2.9")).toBeNull();
    expect(resolveUpdate(PKG, null)).toBeNull();
  });

  test("prerelease lebih lama dari rilisnya", () => {
    expect(resolveUpdate({ ...PKG, version: "0.4.0-beta.1" }, "0.4.0")?.latest).toBe("0.4.0");
    expect(resolveUpdate(PKG, "0.3.0-rc.1")).toBeNull();
  });

  test("versi dari jaringan divalidasi ketat (tanpa escape terminal)", () => {
    expect(isValidVersion("1.2.3")).toBe(true);
    expect(isValidVersion("1.2.3-beta.1+build.5")).toBe(true);
    expect(isValidVersion("\u001b[31m9.9.9")).toBe(false);
    expect(isValidVersion("9.9.9 rm -rf")).toBe(false);
    expect(isValidVersion("latest")).toBe(false);
    expect(isValidVersion(42)).toBe(false);
    expect(resolveUpdate(PKG, "\u001b[31m9.9.9")).toBeNull();
  });

  test("isUpdateInstalled: paket di disk sudah setara/lebih baru", () => {
    const update = resolveUpdate(PKG, "0.4.0");
    if (!update) throw new Error("expected update");
    expect(isUpdateInstalled(update, "0.4.0")).toBe(true);
    expect(isUpdateInstalled(update, "0.4.1")).toBe(true);
    expect(isUpdateInstalled(update, "0.3.0")).toBe(false);
    expect(isUpdateInstalled(update, "dev")).toBe(false);
  });
});

describe("konfigurasi", () => {
  test("aktif hanya di mode cli, bisa dimatikan lewat env", () => {
    expect(updateCheckEnabled({})).toBe(false);
    setRunMode("cli");
    expect(updateCheckEnabled({})).toBe(true);
    expect(updateCheckEnabled({ KCG_NO_UPDATE_CHECK: "1" })).toBe(false);
    expect(updateCheckEnabled({ NO_UPDATE_NOTIFIER: "1" })).toBe(false);
  });

  test("registry: NPM_CONFIG_REGISTRY dihormati, nilai aneh diabaikan", () => {
    expect(registryUrl({})).toBe("https://registry.npmjs.org");
    expect(registryUrl({ NPM_CONFIG_REGISTRY: "https://npm.mirror.test/" })).toBe(
      "https://npm.mirror.test",
    );
    expect(registryUrl({ npm_config_registry: "http://localhost:4873" })).toBe(
      "http://localhost:4873",
    );
    expect(registryUrl({ NPM_CONFIG_REGISTRY: "file:///etc/passwd" })).toBe(
      "https://registry.npmjs.org",
    );
    expect(registryUrl({ NPM_CONFIG_REGISTRY: "not a url" })).toBe("https://registry.npmjs.org");
  });

  test("fetchLatestVersion: URL dist-tag latest, nama ber-scope di-encode", async () => {
    const { fetchFn, urls } = fakeRegistry({ version: "1.0.0" });
    expect(
      await fetchLatestVersion("kcg-code", { fetch: fetchFn, registry: "https://r.test" }),
    ).toBe("1.0.0");
    await fetchLatestVersion("@kcg/code", { fetch: fetchFn, registry: "https://r.test" });
    expect(urls).toEqual(["https://r.test/kcg-code/latest", "https://r.test/@kcg%2Fcode/latest"]);
  });
});

describe("createUpdateChecker", () => {
  test("nonaktif: tidak menyentuh jaringan", async () => {
    const { fetchFn, urls } = fakeRegistry({ version: "9.0.0" });
    const c = createUpdateChecker({ enabled: false, fetch: fetchFn });
    await c.start();
    expect(await c.check()).toBeNull();
    expect(c.available()).toBeNull();
    expect(urls).toEqual([]);
  });

  test("versi baru di registry -> update tersedia & disimpan ke cache", async () => {
    const cachePath = tmpCache();
    const { fetchFn, urls } = fakeRegistry({ version: "0.4.0" });
    const c = checker(fetchFn, cachePath);
    expect(c.available()).toBeNull();
    await c.start();
    c.close();
    expect(urls).toEqual(["https://registry.example.test/kcg-code/latest"]);
    expect(c.available()).toEqual({
      current: "0.3.0",
      latest: "0.4.0",
      command: "bun i -g kcg-code@latest",
    });
    expect(await readUpdateCache(cachePath)).toEqual({ latest: "0.4.0", checkedAt: 1000 });
  });

  test("sudah versi terbaru -> null", async () => {
    const c = checker(fakeRegistry({ version: "0.3.0" }).fetchFn);
    await c.start();
    c.close();
    expect(c.available()).toBeNull();
  });

  test("offline -> pakai hasil cache sebelumnya", async () => {
    const cachePath = tmpCache();
    await Bun.write(cachePath, JSON.stringify({ latest: "0.5.0", checkedAt: 1 }));
    const c = checker(fakeRegistry({ throws: true }).fetchFn, cachePath);
    await c.start();
    c.close();
    expect(c.available()?.latest).toBe("0.5.0");
  });

  test("respons registry tidak valid diabaikan", async () => {
    for (const reply of [{ version: "\u001b[2Jhack" }, { version: "1.0.0", status: 500 }, {}]) {
      const c = checker(fakeRegistry(reply).fetchFn);
      await c.start();
      c.close();
      expect(c.available()).toBeNull();
    }
  });
});
