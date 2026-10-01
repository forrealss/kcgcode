import { describe, expect, test } from "bun:test";
import { parsePermissionTitle } from "../permission-info";

describe("parsePermissionTitle", () => {
  test("judul server: permission + pola ber-backtick", () => {
    const info = parsePermissionTitle(
      "external_directory — `/home/irsyadulibad/.config/opencode/*`",
    );
    expect(info.permission).toBe("external_directory");
    expect(info.label).toBe("Access a folder outside the project");
    expect(info.targets).toEqual(["/home/irsyadulibad/.config/opencode/*"]);
    expect(info.risk).toBe("high");
  });

  test("beberapa pola dipisah", () => {
    const info = parsePermissionTitle("edit — `src/a.ts` — `src/b.ts`");
    expect(info.label).toBe("Edit files");
    expect(info.targets).toEqual(["src/a.ts", "src/b.ts"]);
    expect(info.risk).toBe("medium");
  });

  test("perintah bash yang memuat ' — ' di dalam backtick tidak dipecah sebagai pola baru", () => {
    // Server membungkus tiap pola dengan backtick; pemisah ' — ' hanya di
    // antara pola. Perintah tanpa ' — ' di dalamnya tetap utuh.
    const info = parsePermissionTitle("bash — `mkdir -p /tmp/perm-test`");
    expect(info.label).toBe("Run a shell command");
    expect(info.targets).toEqual(["mkdir -p /tmp/perm-test"]);
    expect(info.risk).toBe("high");
  });

  test("permission tanpa pola", () => {
    const info = parsePermissionTitle("webfetch");
    expect(info.label).toBe("Fetch a web page");
    expect(info.targets).toEqual([]);
  });

  test("baca-saja = risiko rendah", () => {
    expect(parsePermissionTitle("read — `README.md`").risk).toBe("low");
    expect(parsePermissionTitle("grep — `TODO`").risk).toBe("low");
  });

  test("permission tak dikenal: nama ditampilkan (bukan disembunyikan), risiko sedang", () => {
    const info = parsePermissionTitle("future_tool — `x`");
    expect(info.permission).toBe("future_tool");
    expect(info.label).toBe("Future tool");
    expect(info.risk).toBe("medium");
  });

  test("judul kosong / fallback server -> label umum", () => {
    for (const t of [null, "", "  ", "Izin tool"]) {
      const info = parsePermissionTitle(t);
      expect(info.permission).toBeNull();
      expect(info.label).toBe("Use a tool");
      expect(info.targets).toEqual([]);
    }
  });

  test("nama permission tidak peka huruf besar", () => {
    expect(parsePermissionTitle("BASH — `ls`").label).toBe("Run a shell command");
  });
});
