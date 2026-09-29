/**
 * Alamat bind server (src/server/host.ts): default loopback, bisa di-override.
 */
import { expect, test } from "bun:test";
import { DEFAULT_HOSTNAME, resolveHostname } from "../host";

test("default hostname loopback 127.0.0.1", () => {
  expect(DEFAULT_HOSTNAME).toBe("127.0.0.1");
  expect(resolveHostname({})).toBe("127.0.0.1");
});

test("KCG_HOST meng-override hostname", () => {
  expect(resolveHostname({ KCG_HOST: "0.0.0.0" })).toBe("0.0.0.0");
});
