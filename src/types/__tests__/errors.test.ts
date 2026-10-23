/**
 * Unit test registri kode error bersama (src/types/errors.ts) beserta dua
 * pemakainya: `apiErrorMessage` (klien) dan `ErrorCodes` (protokol WS).
 */
import { describe, expect, test } from "bun:test";
import { apiErrorMessage } from "../../lib/api-errors";
import { ErrorCodes } from "../../ws-protocol";
import { ERRORS, type ErrorDef, parseErrorCode, resolveError } from "../errors";

describe("parseErrorCode", () => {
  test("kode polos", () => {
    expect(parseErrorCode("SESSION_NOT_FOUND")).toEqual({
      code: "SESSION_NOT_FOUND",
      detail: null,
    });
  });

  test("detail setelah `:` (dengan / tanpa spasi) dan dalam kurung", () => {
    expect(parseErrorCode("AGENT_MCP_FAILED: boom")).toEqual({
      code: "AGENT_MCP_FAILED",
      detail: "boom",
    });
    expect(parseErrorCode("AUTH_RATE_LIMITED:30")).toEqual({
      code: "AUTH_RATE_LIMITED",
      detail: "30",
    });
    expect(parseErrorCode("SKILLS_SEARCH_FAILED(503)")).toEqual({
      code: "SKILLS_SEARCH_FAILED",
      detail: "503",
    });
  });

  test("detail kosong -> null; bukan kode berdetail -> utuh", () => {
    expect(parseErrorCode("AGENT_MCP_FAILED:  ")).toEqual({
      code: "AGENT_MCP_FAILED",
      detail: null,
    });
    expect(parseErrorCode("HTTP_500 nope")).toEqual({ code: "HTTP_500 nope", detail: null });
    expect(parseErrorCode("lower")).toEqual({ code: "lower", detail: null });
  });
});

describe("resolveError", () => {
  test("kode terdaftar -> status & pesan registri", () => {
    expect(resolveError("PROJECT_NOT_FOUND")).toEqual({
      code: "PROJECT_NOT_FOUND",
      detail: null,
      status: 404,
      message: "Project not found.",
    });
  });

  test("kode berdetail memakai kode dasarnya", () => {
    expect(resolveError("AUTH_RATE_LIMITED:12").status).toBe(429);
    expect(resolveError("SKILLS_AUDIT_FAILED: timeout").status).toBe(502);
    expect(resolveError("PREVIEW_SPAWN_FAILED: ENOENT").status).toBe(500);
    expect(resolveError("OPENCODE_UPGRADE_REQUIRED: 1.4.2").status).toBe(503);
  });

  test("pesan berdetail", () => {
    expect(resolveError("OPENCODE_UPGRADE_REQUIRED: 1.4.2").message).toContain("opencode 1.4.2");
    expect(resolveError("OPENCODE_UPGRADE_REQUIRED").message).toContain("opencode 1.x");
    expect(resolveError('AGENT_MCP_FAILED: Executable not found in $PATH: "npx"').message).toBe(
      'Executable not found in $PATH: "npx"',
    );
    expect(resolveError("AGENT_MCP_FAILED").message).toBe(
      "The agent couldn't update the MCP server.",
    );
  });

  test("kode tak terdaftar: prefiks AGENT_ -> 502, lainnya 500 tanpa pesan", () => {
    expect(resolveError("AGENT_SOMETHING_NEW: x")).toMatchObject({ status: 502, message: null });
    expect(resolveError("WHATEVER")).toMatchObject({ status: 500, message: null });
    expect(resolveError("")).toMatchObject({ status: 500, message: null });
  });

  test("nama properti Object.prototype bukan kode", () => {
    expect(resolveError("constructor")).toMatchObject({ status: 500, message: null });
    expect(resolveError("toString")).toMatchObject({ status: 500, message: null });
  });
});

describe("isi registri", () => {
  test("status error HTTP & pesan tidak kosong", () => {
    for (const [code, def] of Object.entries(ERRORS) as [string, ErrorDef][]) {
      expect(def.status, code).toBeGreaterThanOrEqual(400);
      expect(def.status, code).toBeLessThan(600);
      const message = typeof def.message === "function" ? def.message(null) : def.message;
      expect(message.length, code).toBeGreaterThan(0);
    }
  });

  test("kode protokol WebSocket terdaftar", () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(Object.hasOwn(ERRORS, code), code).toBe(true);
    }
  });

  test("celah audit kini punya pesan klien", () => {
    for (const code of [
      "INVALID_EFFORT",
      "AUTO_LOCK_INVALID",
      "LOCK_KIND_INVALID",
      "PATH_NOT_FOUND",
      "SESSION_NOT_ACTIVE",
      "INSTALL_JOB_LOST",
    ]) {
      expect(apiErrorMessage(code), code).not.toContain("Something went wrong");
    }
  });
});

describe("apiErrorMessage", () => {
  test("kode terdaftar & berdetail", () => {
    expect(apiErrorMessage("SESSION_NOT_FOUND")).toBe("Session not found.");
    expect(apiErrorMessage("AGENT_LIST_MODELS_FAILED: 500")).toBe(
      "Failed to load the model list from the agent.",
    );
  });

  test("kode tak dikenal -> pesan generik dengan kode utuh", () => {
    expect(apiErrorMessage("HTTP_502")).toBe("Something went wrong (HTTP_502).");
    expect(apiErrorMessage("AGENT_NEW_FAILED: x")).toBe(
      "Something went wrong (AGENT_NEW_FAILED: x).",
    );
  });
});

describe("kode agent bersatu (AGENT_*)", () => {
  test("tidak ada lagi kode khusus Claude (CC_*) di registri", () => {
    expect(Object.keys(ERRORS).filter((c) => c.startsWith("CC_"))).toEqual([]);
  });

  test("AGENT_SESSION_NOT_FOUND (dengan / tanpa detail) -> 404", () => {
    expect(resolveError("AGENT_SESSION_NOT_FOUND").status).toBe(404);
    expect(resolveError("AGENT_SESSION_NOT_FOUND: gone").status).toBe(404);
  });
});
