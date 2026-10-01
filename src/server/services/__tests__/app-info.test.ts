import { describe, expect, test } from "bun:test";
import { resolveVersionLabel } from "../app-info";

describe("resolveVersionLabel", () => {
  test("bun dev (mode dev, tanpa NODE_ENV) -> 'dev'", () => {
    expect(resolveVersionLabel("0.1.0", "dev", undefined)).toBe("dev");
    expect(resolveVersionLabel("0.1.0", "dev", "development")).toBe("dev");
  });

  test("bun start (mode dev + NODE_ENV=production) -> versi package", () => {
    expect(resolveVersionLabel("0.1.0", "dev", "production")).toBe("0.1.0");
  });

  test("CLI global -> selalu versi package", () => {
    expect(resolveVersionLabel("1.2.3", "cli", undefined)).toBe("1.2.3");
    expect(resolveVersionLabel("1.2.3", "cli", "production")).toBe("1.2.3");
  });
});
