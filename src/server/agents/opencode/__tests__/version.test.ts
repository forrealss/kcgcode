/**
 * Deteksi versi CLI opencode (`version.ts`): parse `opencode --version` dan
 * penolakan v1 / CLI tidak terpasang.
 */
import { describe, expect, test } from "bun:test";
import {
  checkOpencodeVersion,
  OPENCODE_NOT_FOUND,
  OPENCODE_UPGRADE_REQUIRED,
  parseOpencodeVersion,
} from "../version";

describe("versi opencode", () => {
  test("parse output `opencode --version`", () => {
    expect(parseOpencodeVersion("opencode v2.0.28\n")).toEqual({ version: "2.0.28", major: 2 });
    expect(parseOpencodeVersion("1.4.3")).toEqual({ version: "1.4.3", major: 1 });
    expect(parseOpencodeVersion("2.1.0-beta.3")).toEqual({ version: "2.1.0-beta.3", major: 2 });
    expect(parseOpencodeVersion("tidak ada versi")).toBeNull();
  });

  test("v1 -> OPENCODE_UPGRADE_REQUIRED; tidak terpasang -> OPENCODE_NOT_FOUND; v2 -> ok", async () => {
    expect(await checkOpencodeVersion(async () => ({ ok: true, output: "1.4.3" }))).toEqual({
      ok: false,
      error: `${OPENCODE_UPGRADE_REQUIRED}: 1.4.3`,
    });
    expect(
      await checkOpencodeVersion(async () => ({ ok: false, notFound: true, error: "ENOENT" })),
    ).toEqual({ ok: false, error: OPENCODE_NOT_FOUND });
    expect(
      await checkOpencodeVersion(async () => ({ ok: true, output: "opencode v2.0.28" })),
    ).toEqual({
      ok: true,
      data: { version: "2.0.28", major: 2 },
    });
  });
});
