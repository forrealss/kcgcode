import { describe, expect, test } from "bun:test";
import {
  b64urlDecode,
  b64urlEncode,
  createVapidJwt,
  encryptPayload,
  generateVapidKeys,
  isValidAuthSecret,
  isValidEndpoint,
  isValidP256dh,
  sendPush,
} from "../web-push";

// RFC 8291 Appendix A — nilai antara enkripsi.
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

async function rfcLocalKey() {
  const pub = b64urlDecode(RFC.asPublic);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: RFC.asPrivate,
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return { publicRaw: pub, privateKey };
}

describe("encryptPayload", () => {
  test("sesuai test vector RFC 8291 Appendix A", async () => {
    const out = await encryptPayload(
      b64urlDecode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: b64urlDecode(RFC.salt), localKey: await rfcLocalKey() },
    );
    const expected = new Uint8Array([...b64urlDecode(RFC.header), ...b64urlDecode(RFC.ciphertext)]);
    expect(b64urlEncode(out)).toBe(b64urlEncode(expected));
  });

  test("salt & kunci sementara acak tiap pesan", async () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const a = await encryptPayload(new TextEncoder().encode("hi"), keys);
    const b = await encryptPayload(new TextEncoder().encode("hi"), keys);
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
  });
});

describe("VAPID", () => {
  test("JWT ES256 terverifikasi dengan kunci publik VAPID", async () => {
    const vapid = await generateVapidKeys();
    expect(b64urlDecode(vapid.publicKey).length).toBe(65);
    const jwt = await createVapidJwt(
      "https://fcm.googleapis.com",
      "https://example.com",
      vapid.privateJwk,
      1_900_000_000,
    );
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_900_000_000,
      sub: "https://example.com",
    });
    const pub = await crypto.subtle.importKey(
      "raw",
      b64urlDecode(vapid.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});

describe("validasi subscription", () => {
  test("p256dh, auth, endpoint", () => {
    expect(isValidP256dh(RFC.uaPublic)).toBe(true);
    expect(isValidP256dh(RFC.auth)).toBe(false);
    expect(isValidAuthSecret(RFC.auth)).toBe(true);
    expect(isValidAuthSecret(RFC.uaPublic)).toBe(false);
    expect(isValidEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isValidEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isValidEndpoint("not a url")).toBe(false);
  });
});

describe("sendPush", () => {
  const target = {
    endpoint: "https://push.example.com/send/abc",
    keys: { p256dh: RFC.uaPublic, auth: RFC.auth },
  };

  test("header VAPID & aes128gcm; 201 = ok", async () => {
    const vapid = await generateVapidKeys();
    let seen: Request | null = null;
    const res = await sendPush(target, '{"title":"x"}', {
      vapid,
      subject: "https://example.com",
      ttlSec: 60,
      urgency: "high",
      fetchFn: (async (url: string, init: RequestInit) => {
        seen = new Request(url, init);
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, status: 201 });
    const req = seen as unknown as Request;
    expect(req.headers.get("content-encoding")).toBe("aes128gcm");
    expect(req.headers.get("ttl")).toBe("60");
    expect(req.headers.get("urgency")).toBe("high");
    expect(req.headers.get("authorization")).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`),
    );
  });

  test("410 -> gone (subscription dihapus pemanggil)", async () => {
    const vapid = await generateVapidKeys();
    const res = await sendPush(target, "{}", {
      vapid,
      subject: "https://example.com",
      ttlSec: 60,
      fetchFn: (async () => new Response("expired", { status: 410 })) as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: false, status: 410, gone: true, reason: "expired" });
  });

  test("error jaringan tidak melempar", async () => {
    const vapid = await generateVapidKeys();
    const res = await sendPush(target, "{}", {
      vapid,
      subject: "https://example.com",
      ttlSec: 60,
      fetchFn: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: false, status: 0, gone: false, reason: "offline" });
  });
});
