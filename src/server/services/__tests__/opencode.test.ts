/**
 * Unit test helper murni `opencode-client.ts` & `opencode-server.ts`.
 *
 * Yang diuji (tanpa jaringan/proses sungguhan):
 * - `parseSseFrame` / `normalizeEvent`: parsing & normalisasi event SSE.
 * - `parseListeningPort`: ekstraksi port dari baris log server.
 * - `flattenProviders`: respons GET /config/providers -> daftar model UI.
 * - `flattenAgents`: respons GET /agent -> daftar mode (primary/all saja).
 * - `configFingerprint`: deteksi perubahan file config opencode.
 * - `ensureFreshServer`: restart saat fingerprint config berubah.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import type { OpenCodeClient } from "../opencode-client";
import { flattenAgents, flattenProviders } from "../opencode-client";
import {
  configFingerprint,
  createOpenCodeServerManager,
  parseListeningPort,
  type ServerProcessLike,
} from "../opencode-server";
import { normalizeEvent, parseSseFrame } from "../opencode-sse";

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

test("flattenAgents: hanya primary/all; subagent murni disaring", () => {
  const agents = flattenAgents([
    { name: "build", mode: "primary", description: "Full tool access" },
    { name: "plan", mode: "primary", description: "Planning only" },
    { name: "general", mode: "subagent", description: "Sub-agent" },
    { name: "explore", mode: "all", description: null },
    { name: "", mode: "primary" },
    "rusak",
  ]);
  expect(agents.map((a) => a.name)).toEqual(["build", "plan", "explore"]);
  expect(agents[2]).toEqual({ name: "explore", mode: "all", description: null });
});

test("flattenAgents: payload bukan array / kosong -> []", () => {
  expect(flattenAgents(null)).toEqual([]);
  expect(flattenAgents({})).toEqual([]);
  expect(flattenAgents([])).toEqual([]);
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

// ---------------------------------------------------------------------------
// configFingerprint / ensureFreshServer (live reread config opencode)
// ---------------------------------------------------------------------------

function makeFakeProc(port: number): ServerProcessLike & { kills: string[] } {
  const kills: string[] = [];
  let resolveExited: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((res) => {
    resolveExited = res;
  });
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  // stderr sengaja tidak di-close: ensureServer menunggu baris "listening".
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`opencode server listening on http://127.0.0.1:${port}\n`));
    },
  });
  return {
    kills,
    kill(signal) {
      kills.push(signal);
      resolveExited(0);
    },
    exited,
    stderr,
    stdout,
    pid: undefined,
  };
}

function makeFakeClientFactory() {
  const clients: OpenCodeClient[] = [];
  const factory = (): OpenCodeClient => {
    const client = {
      health: async () => true,
      subscribeEvents: () => () => {},
    } as unknown as OpenCodeClient;
    clients.push(client);
    return client;
  };
  return { clients, factory };
}

function makeFastManager() {
  const procs: ReturnType<typeof makeFakeProc>[] = [];
  const { clients, factory } = makeFakeClientFactory();
  let nextPort = 9000;
  const manager = createOpenCodeServerManager({
    portTimeoutMs: 2000,
    readyTimeoutMs: 2000,
    spawn: () => {
      const proc = makeFakeProc(nextPort++);
      procs.push(proc);
      return proc;
    },
    clientFactory: factory,
  });
  return { manager, procs, clients };
}

test("configFingerprint: file project ikut masuk dan berubah saat disentuh", () => {
  const dir = mkdtempSync(join(tmpdir(), "kcg-fp-"));
  const base = configFingerprint(dir);
  const p = join(dir, "opencode.json");
  writeFileSync(p, "{}");
  const t = new Date("2026-01-01T00:00:00Z");
  utimesSync(p, t, t);
  const fp1 = configFingerprint(dir);
  expect(fp1).toContain("opencode.json");
  expect(fp1).not.toBe(base);
  // Stabil bila file tidak disentuh.
  expect(configFingerprint(dir)).toBe(fp1);
  // Sentuh file -> fingerprint berubah.
  utimesSync(p, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));
  expect(configFingerprint(dir)).not.toBe(fp1);
});

test("ensureFreshServer: config tak berubah -> instance sama; berubah -> restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kcg-fresh-"));
  const { manager, procs } = makeFastManager();

  const first = await manager.ensureFreshServer("p1", dir);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(procs).toHaveLength(1);

  // Config tidak berubah: tidak spawn ulang.
  const second = await manager.ensureFreshServer("p1", dir);
  expect(second.ok).toBe(true);
  expect(procs).toHaveLength(1);
  if (second.ok) expect(second.data.baseUrl).toBe(first.data.baseUrl);

  // Ubah config project -> fingerprint beda -> stop + spawn baru.
  writeFileSync(join(dir, "opencode.json"), "{}");
  const third = await manager.ensureFreshServer("p1", dir);
  expect(third.ok).toBe(true);
  if (!third.ok) return;
  expect(procs).toHaveLength(2);
  expect(procs[0]?.kills).toContain("SIGTERM");
  expect(third.data.baseUrl).not.toBe(first.data.baseUrl);
});
