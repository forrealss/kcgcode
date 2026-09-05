/**
 * Unit test helper murni `opencode-client.ts` & `opencode-server.ts`.
 *
 * Yang diuji (tanpa jaringan/proses sungguhan):
 * - `parseSseFrame` / `normalizeEvent`: parsing & normalisasi event SSE.
 * - `parseListeningPort`: ekstraksi port dari baris log server.
 * - `flattenProviders`: respons GET /config/providers -> daftar model UI.
 */
import { expect, test } from "bun:test";
import fc from "fast-check";
import { flattenProviders, normalizeEvent, parseSseFrame } from "../opencode-client";
import { parseListeningPort } from "../opencode-server";

test("parseSseFrame: mengambil baris data; frame tanpa data -> null", () => {
  expect(parseSseFrame('data: {"a":1}\n\n')).toBe('{"a":1}');
  expect(parseSseFrame("event: x\ndata: hello\n")).toBe("hello");
  expect(parseSseFrame("comment saja\n\n")).toBeNull();
  expect(parseSseFrame("")).toBeNull();
});

test("normalizeEvent: {id,type,properties} -> event datar (type + properties)", () => {
  const ev = normalizeEvent({
    id: "evt_1",
    type: "permission.asked",
    properties: { requestID: "per_1", sessionID: "ses_1", permission: "bash:ls" },
  });
  expect(ev).toEqual({
    id: "evt_1",
    type: "permission.asked",
    requestID: "per_1",
    sessionID: "ses_1",
    permission: "bash:ls",
  });

  // Payload tanpa properties -> tetap aman.
  expect(normalizeEvent({ type: "server.connected" })).toEqual({ type: "server.connected" });

  // Payload invalid -> null.
  expect(normalizeEvent(null)).toBeNull();
  expect(normalizeEvent("x")).toBeNull();
  expect(normalizeEvent({})).toBeNull();
  expect(normalizeEvent({ id: 1 })).toBeNull();
});

test("parseListeningPort: mengekstrak port dari baris log opencode", () => {
  expect(parseListeningPort("opencode server listening on http://127.0.0.1:4096")).toBe(4096);
  expect(parseListeningPort("listening on http://0.0.0.0:4599")).toBe(4599);
  expect(parseListeningPort("beberapa teks tanpa port")).toBeNull();
  expect(parseListeningPort("port 80 di tengah teks")).toBeNull();
});

test("parseListeningPort: properti — port valid apa pun selalu diekstrak", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1024, max: 65535 }), (p) => {
      expect(parseListeningPort(`opencode server listening on http://127.0.0.1:${p}`)).toBe(p);
    }),
    { numRuns: 50 },
  );
});

// ---------------------------------------------------------------------------
// flattenProviders (GET /config/providers -> daftar model untuk UI)
// ---------------------------------------------------------------------------

test("flattenProviders: flatten provider + model dengan nama tampilan", () => {
  const payload = {
    providers: [
      {
        id: "kcgcode",
        name: "kcgcode",
        models: {
          "kiro/claude-opus-5": { id: "kiro/claude-opus-5", name: "Claude Opus 5" },
          "mimo/mimo-v2.5": { id: "mimo/mimo-v2.5" }, // tanpa name -> fallback id
        },
      },
    ],
  };
  expect(flattenProviders(payload)).toEqual([
    {
      providerID: "kcgcode",
      providerName: "kcgcode",
      modelID: "kiro/claude-opus-5",
      name: "Claude Opus 5",
    },
    {
      providerID: "kcgcode",
      providerName: "kcgcode",
      modelID: "mimo/mimo-v2.5",
      name: "mimo/mimo-v2.5",
    },
  ]);
});

test("flattenProviders: model deprecated disaring", () => {
  const payload = {
    providers: [
      {
        id: "p",
        name: "P",
        models: {
          lama: { id: "lama", status: "deprecated" },
          baru: { id: "baru", status: "active" },
        },
      },
    ],
  };
  const out = flattenProviders(payload);
  expect(out.map((m) => m.modelID)).toEqual(["baru"]);
});

test("flattenProviders: payload tidak valid / kosong -> []", () => {
  expect(flattenProviders(null)).toEqual([]);
  expect(flattenProviders({})).toEqual([]);
  expect(flattenProviders({ providers: "bukan array" })).toEqual([]);
  // provider tanpa id / tanpa models diabaikan
  expect(flattenProviders({ providers: [{ name: "tanpa-id" }, { id: "kosong" }] })).toEqual([]);
});

test("flattenProviders: provider name kosong fallback ke id", () => {
  const out = flattenProviders({
    providers: [{ id: "opencode", name: "", models: { m1: { id: "m1", name: "M1" } } }],
  });
  expect(out[0]).toMatchObject({ providerID: "opencode", providerName: "opencode" });
});
