/**
 * Property & unit test `auth.ts` (task 18).
 *
 * - Property 26: Otentikasi konsisten terhadap kredensial (9.2, 9.3)
 * - Unit 18.3: default bind jaringan — `KCG_HOST` tidak diatur -> loopback;
 *   `KCG_AUTH_ENABLED` tidak diatur -> request diterima tanpa kredensial (9.1)
 *
 * Seluruh kombinasi kredensial dihasilkan fast-check; `isAuthorized` murni
 * (tanpa I/O), sehingga cocok untuk property-based testing.
 */
import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  type AuthConfig,
  type AuthRequest,
  bearerToken,
  DEFAULT_HOSTNAME,
  isAuthorized,
  loadAuthConfig,
  unauthorizedResponse,
  WS_AUTH_CLOSE_CODE,
} from "../auth";

// ---------------------------------------------------------------------------
// Property 26 — Otentikasi konsisten terhadap kredensial (9.2, 9.3)
// ---------------------------------------------------------------------------

// Feature: kcg-bridge, Property 26: Otentikasi konsisten terhadap kredensial
test("Property 26: diterima iff kredensial cocok; semua kombinasi lain ditolak", () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 20 }), // token terkonfigurasi (KCG_AUTH_TOKEN)
      fc.option(fc.string({ maxLength: 30 })), // header Authorization mentah (atau null)
      fc.option(fc.string({ maxLength: 20 })), // query token (atau null)
      fc.boolean(), // KCG_AUTH_ENABLED
      (configToken, rawHeader, queryToken, enabled) => {
        const config: AuthConfig = {
          hostname: DEFAULT_HOSTNAME,
          authEnabled: enabled,
          authToken: configToken,
        };
        const req: AuthRequest = { authHeader: rawHeader, queryToken };

        // Model: token efektif = Bearer dari header (jika ada), else query token.
        // Diterima iff: auth mati, ATAU (token terkonfigurasi non-kosong DAN
        // token efektif sama persis).
        const provided = bearerToken(rawHeader) ?? queryToken;
        const expected =
          !enabled || (configToken.length > 0 && provided !== null && provided === configToken);

        expect(isAuthorized(config, req)).toBe(expected);
      },
    ),
    { numRuns: 100 },
  );
});

test("Property 26: token terkonfigurasi kosong + auth aktif -> semua ditolak", () => {
  fc.assert(
    fc.property(
      fc.option(fc.string({ maxLength: 20 })),
      fc.option(fc.string({ maxLength: 20 })),
      (rawHeader, queryToken) => {
        const config: AuthConfig = {
          hostname: DEFAULT_HOSTNAME,
          authEnabled: true,
          authToken: "",
        };
        expect(isAuthorized(config, { authHeader: rawHeader, queryToken })).toBe(false);
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Unit 18.3 — default bind jaringan (9.1)
// ---------------------------------------------------------------------------

test("18.3: KCG_HOST tidak diatur -> default loopback", () => {
  const cfg = loadAuthConfig({});
  expect(cfg.hostname).toBe("127.0.0.1");
  expect(cfg.authEnabled).toBe(false);
  expect(cfg.authToken).toBe("");
});

test("18.3: KCG_HOST diatur -> dipakai apa adanya", () => {
  const cfg = loadAuthConfig({ KCG_HOST: "0.0.0.0" });
  expect(cfg.hostname).toBe("0.0.0.0");
});

test("18.3: KCG_AUTH_ENABLED tidak diatur -> request diterima tanpa kredensial", () => {
  const cfg = loadAuthConfig({});
  expect(isAuthorized(cfg, { authHeader: null, queryToken: null })).toBe(true);
});

test("18.3: KCG_AUTH_ENABLED=true membutuhkan kredensial yang cocok", () => {
  const cfg = loadAuthConfig({ KCG_AUTH_ENABLED: "true", KCG_AUTH_TOKEN: "secret" });
  expect(cfg.authEnabled).toBe(true);

  // header Bearer benar / salah
  expect(isAuthorized(cfg, { authHeader: "Bearer secret", queryToken: null })).toBe(true);
  expect(isAuthorized(cfg, { authHeader: "Bearer wrong", queryToken: null })).toBe(false);
  // query token (upgrade WS)
  expect(isAuthorized(cfg, { authHeader: null, queryToken: "secret" })).toBe(true);
  expect(isAuthorized(cfg, { authHeader: null, queryToken: "wrong" })).toBe(false);
  // tanpa kredensial
  expect(isAuthorized(cfg, { authHeader: null, queryToken: null })).toBe(false);
});

test("18.3: KCG_AUTH_ENABLED bukan 'true' -> auth mati walau token terisi", () => {
  const cfg = loadAuthConfig({ KCG_AUTH_ENABLED: "false", KCG_AUTH_TOKEN: "secret" });
  expect(cfg.authEnabled).toBe(false);
  expect(isAuthorized(cfg, { authHeader: null, queryToken: null })).toBe(true);
});

// ---------------------------------------------------------------------------
// Unit parsing header & kode penolakan
// ---------------------------------------------------------------------------

test("bearerToken: parsing header Authorization Bearer", () => {
  expect(bearerToken("Bearer abc123")).toBe("abc123");
  expect(bearerToken("bearer x")).toBe("x"); // case-insensitive
  expect(bearerToken("Basic dXNlcjpwYXNz")).toBeNull();
  expect(bearerToken("Bearer ")).toBeNull();
  expect(bearerToken(null)).toBeNull();
  expect(bearerToken(undefined)).toBeNull();
});

test("unauthorizedResponse -> HTTP 401; WS close code 4401", () => {
  const res = unauthorizedResponse();
  expect(res.status).toBe(401);
  expect(WS_AUTH_CLOSE_CODE).toBe(4401);
});
