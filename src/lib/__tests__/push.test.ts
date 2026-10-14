/**
 * Web Push di browser: kapan push tersedia, konversi kunci VAPID, dan
 * keputusan tab untuk notifikasi `notify` (suara / toast / ack).
 */
import { describe, expect, test } from "bun:test";
import type { AgentNotification } from "@/types";
import { planNotify } from "../agent-notify";
import { resolvePushSupport, vapidKeyBytes } from "../push";

const env = {
  secure: true,
  hasPush: true,
  hostname: "me.kcgcode.example",
  ios: false,
  standalone: false,
};

describe("resolvePushSupport", () => {
  test("HTTPS + Push API -> tersedia", () => {
    expect(resolvePushSupport(env)).toBe("supported");
  });
  test("HTTP ke IP LAN -> butuh HTTPS", () => {
    expect(resolvePushSupport({ ...env, secure: false, hostname: "192.168.1.5" })).toBe("insecure");
  });
  test("iOS di tab Safari -> Add to Home Screen dulu; dari app -> tersedia", () => {
    expect(resolvePushSupport({ ...env, ios: true })).toBe("ios-install");
    expect(resolvePushSupport({ ...env, ios: true, standalone: true })).toBe("supported");
  });
  test("alamat localhost.run yang berganti-ganti -> tidak ditawarkan", () => {
    expect(resolvePushSupport({ ...env, hostname: "abc123.lhr.life" })).toBe("ephemeral");
  });
  test("browser tanpa Push API", () => {
    expect(resolvePushSupport({ ...env, hasPush: false })).toBe("unsupported");
  });
});

test("vapidKeyBytes: base64url tanpa padding -> byte", () => {
  expect([...vapidKeyBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
});

describe("planNotify", () => {
  const n: AgentNotification = {
    id: "n1",
    kind: "permission",
    sessionId: "s1",
    title: "Permission needed",
    body: "Fix bug · app",
    url: "/projects/p1/sessions/s1",
    createdAt: 1,
  };
  const endpoint = "https://push.example.com/me";

  test("tab terlihat di halaman lain: suara + toast + ack", () => {
    expect(planNotify(n, { visible: true, pathname: "/", endpoint, sound: true })).toEqual({
      sound: true,
      toast: true,
      ack: endpoint,
    });
  });

  test("sedang membuka Session itu: tanpa toast (kartu sudah tampil)", () => {
    expect(planNotify(n, { visible: true, pathname: n.url, endpoint, sound: true }).toast).toBe(
      false,
    );
  });

  test("tab tersembunyi + berlangganan push: diam, tanpa ack (push yang bunyi)", () => {
    expect(planNotify(n, { visible: false, pathname: "/", endpoint, sound: true })).toEqual({
      sound: false,
      toast: false,
      ack: null,
    });
  });

  test("tab tersembunyi tanpa push: suara jadi satu-satunya kabar", () => {
    expect(
      planNotify(n, { visible: false, pathname: "/", endpoint: null, sound: true }).sound,
    ).toBe(true);
  });

  test("suara dimatikan di Settings", () => {
    expect(planNotify(n, { visible: true, pathname: "/", endpoint, sound: false }).sound).toBe(
      false,
    );
  });
});
