/**
 * Notification_Service: notifikasi agent ke tab terbuka (WS) + Web Push ke
 * perangkat yang tidak membalas `notify_ack` dalam jendela ack.
 */
import { afterEach, expect, test } from "bun:test";
import { openSessionStore, type SessionStore } from "../../../db";
import type { AgentNotification, InteractivePrompt } from "../../../types";
import { createNotificationService, MAX_PUSH_SUBSCRIPTIONS } from "../notifications";

// Kunci p256dh/auth valid dari RFC 8291 Appendix A.
const P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

interface Harness {
  store: SessionStore;
  sent: AgentNotification[];
  /** Endpoint yang menerima POST push. */
  pushed: string[];
  /** Status HTTP balasan layanan push per endpoint (default 201). */
  statusFor: Map<string, number>;
  timers: (() => void)[];
  svc: ReturnType<typeof createNotificationService>;
  fireTimers(): Promise<void>;
}

let open: SessionStore[] = [];
afterEach(() => {
  for (const s of open) s.close();
  open = [];
});

function harness(): Harness {
  const store = openSessionStore(":memory:");
  open.push(store);
  store.insertProject({ id: "p1", name: "my-app", path: "/sandbox/my-app", createdAt: 1 });
  store.insertSession({
    id: "s1",
    projectId: "p1",
    agentType: "opencode",
    cwd: "/sandbox/my-app",
    status: "running",
    ocSessionId: "ses_1",
    model: null,
    agent: null,
    title: "Fix login bug",
    createdAt: 1,
    updatedAt: 1,
  });
  const sent: AgentNotification[] = [];
  const pushed: string[] = [];
  const statusFor = new Map<string, number>();
  const timers: (() => void)[] = [];
  const svc = createNotificationService({
    store,
    broadcast: (n) => sent.push(n),
    subject: "https://example.com",
    now: () => 1000,
    log: () => {},
    setTimeoutFn: (cb) => {
      timers.push(cb);
      return timers.length;
    },
    clearTimeoutFn: () => {},
    fetchFn: (async (url: string) => {
      pushed.push(url);
      return new Response(null, { status: statusFor.get(url) ?? 201 });
    }) as unknown as typeof fetch,
  });
  return {
    store,
    sent,
    pushed,
    statusFor,
    timers,
    svc,
    async fireTimers() {
      for (const t of timers.splice(0)) t();
      // Biarkan enkripsi + fetch palsu selesai.
      await Bun.sleep(50);
    },
  };
}

function subscribe(h: Harness, endpoint: string) {
  const res = h.svc.subscribe({ endpoint, p256dh: P256DH, auth: AUTH, userAgent: "Chrome/1" });
  if (!res.ok || !res.data) throw new Error("subscribe gagal");
  return res.data;
}

function permissionPrompt(): InteractivePrompt {
  return {
    id: "per_1",
    sessionId: "s1",
    kind: "permission",
    type: "confirmation",
    title: "bash: rm -rf build",
    options: null,
    status: "pending",
    createdAt: 1,
  } as InteractivePrompt;
}

test("kartu izin -> notify ke tab: judul Session & Project, tanpa detail perintah", () => {
  const h = harness();
  h.svc.promptAsked(permissionPrompt());
  expect(h.sent).toHaveLength(1);
  const n = h.sent[0] as AgentNotification;
  expect(n).toMatchObject({
    kind: "permission",
    sessionId: "s1",
    title: "Permission needed",
    body: "Fix login bug · my-app",
    url: "/projects/p1/sessions/s1",
  });
  // Notifikasi tampil di layar kunci — detail perintah tidak ikut.
  expect(JSON.stringify(n)).not.toContain("rm -rf");
  // Tanpa perangkat berlangganan: tidak ada timer push.
  expect(h.timers).toHaveLength(0);
});

test("push dikirim setelah jendela ack ke perangkat yang tidak ack", async () => {
  const h = harness();
  subscribe(h, "https://push.example.com/phone");
  subscribe(h, "https://push.example.com/laptop");
  h.svc.turnEnded("s1", "done");
  const n = h.sent[0] as AgentNotification;
  expect(n.title).toBe("Agent finished");

  // Laptop sedang membuka app (tab terlihat) -> ack.
  h.svc.ack(n.id, "https://push.example.com/laptop");
  expect(h.pushed).toEqual([]);
  await h.fireTimers();
  expect(h.pushed).toEqual(["https://push.example.com/phone"]);
});

test("ack untuk notifikasi lain tidak menahan push", async () => {
  const h = harness();
  subscribe(h, "https://push.example.com/phone");
  h.svc.turnEnded("s1", "failed");
  h.svc.ack("bukan-id-ini", "https://push.example.com/phone");
  await h.fireTimers();
  expect(h.pushed).toEqual(["https://push.example.com/phone"]);
  expect(h.sent[0]?.title).toBe("Agent stopped with an error");
});

test("layanan push membalas 410 -> perangkat dihapus", async () => {
  const h = harness();
  subscribe(h, "https://push.example.com/old");
  h.statusFor.set("https://push.example.com/old", 410);
  h.svc.promptAsked(permissionPrompt());
  await h.fireTimers();
  expect(h.svc.listDevices()).toEqual([]);
});

test("Session tak dikenal -> tidak ada notifikasi", () => {
  const h = harness();
  h.svc.turnEnded("tidak-ada", "done");
  expect(h.sent).toEqual([]);
});

test("subscribe: validasi, upsert idempoten, refreshOnly, batas perangkat", () => {
  const h = harness();
  expect(
    h.svc.subscribe({ endpoint: "http://x", p256dh: P256DH, auth: AUTH, userAgent: null }),
  ).toEqual({ ok: false, error: "PUSH_ENDPOINT_INVALID" });
  expect(
    h.svc.subscribe({ endpoint: "https://x", p256dh: AUTH, auth: AUTH, userAgent: null }),
  ).toEqual({ ok: false, error: "PUSH_KEYS_INVALID" });

  const a = subscribe(h, "https://push.example.com/a");
  const again = subscribe(h, "https://push.example.com/a");
  expect(again.id).toBe(a.id);
  expect(h.svc.listDevices()).toHaveLength(1);

  // Sinkron saat app dibuka: perangkat yang sudah dihapus tidak hidup lagi.
  h.svc.unsubscribe(a.id);
  const refreshed = h.svc.subscribe(
    { endpoint: "https://push.example.com/a", p256dh: P256DH, auth: AUTH, userAgent: null },
    { refreshOnly: true },
  );
  expect(refreshed).toEqual({ ok: true, data: null });
  expect(h.svc.listDevices()).toHaveLength(0);

  for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS; i++) subscribe(h, `https://push.example.com/${i}`);
  expect(
    h.svc.subscribe({
      endpoint: "https://push.example.com/extra",
      p256dh: P256DH,
      auth: AUTH,
      userAgent: null,
    }),
  ).toEqual({ ok: false, error: "PUSH_LIMIT" });
});

test("kunci VAPID dibuat sekali dan dipakai ulang", async () => {
  const h = harness();
  const k1 = await h.svc.publicKey();
  const k2 = await h.svc.publicKey();
  expect(k1).toBe(k2);
  expect(h.store.getVapidKeys()?.publicKey).toBe(k1);
});

test("sendTest: langsung terkirim; perangkat tak dikenal / kedaluwarsa", async () => {
  const h = harness();
  const dev = subscribe(h, "https://push.example.com/phone");
  expect(await h.svc.sendTest(dev.id)).toEqual({ ok: true, data: null });
  expect(h.pushed).toEqual(["https://push.example.com/phone"]);
  expect(await h.svc.sendTest("nope")).toEqual({ ok: false, error: "PUSH_DEVICE_NOT_FOUND" });

  h.statusFor.set("https://push.example.com/phone", 404);
  expect(await h.svc.sendTest(dev.id)).toEqual({ ok: false, error: "PUSH_DEVICE_GONE" });
  expect(h.svc.listDevices()).toEqual([]);
});
