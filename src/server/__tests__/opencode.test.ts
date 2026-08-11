/**
 * Unit test helper murni `opencode-client.ts` & `opencode-server.ts`.
 *
 * Yang diuji (tanpa jaringan/proses sungguhan):
 * - `parseSseFrame` / `normalizeEvent`: parsing & normalisasi event SSE.
 * - `parseListeningPort`: ekstraksi port dari baris log server.
 */
import { expect, test } from "bun:test";
import fc from "fast-check";
import { normalizeEvent, parseSseFrame } from "../opencode-client";
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
