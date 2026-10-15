/**
 * Property test registri subscriber (`gateway/subscriber-registry.ts`):
 * broadcast konsisten ke banyak Client; kegagalan `send` satu Client tidak
 * menghentikan Client lain (5.3).
 *
 * `Subscriber` (ws.send) dan `SessionManager` di-mock; store `bun:sqlite`
 * asli sesuai batasan mocking `design.md`. Harness bersama ada di
 * `harness.ts`.
 */
import { expect, test } from "bun:test";
import fc from "fast-check";
import type { ServerMessage } from "../../../../ws-protocol";
import { freshHarness, makeMessage, makeSub } from "./harness";

test("Property 15/16: broadcast konsisten ke banyak client; client gagal diisolasi (5.3)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 6 }),
      fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }),
      fc.array(fc.string({ maxLength: 20 }), { maxLength: 10 }),
      (clientCount, failFlags, msgIds) => {
        const h = freshHarness();
        try {
          const flags = Array.from(
            { length: clientCount },
            (_, i) => failFlags[i % failFlags.length],
          );
          const healthy = flags.filter((f) => !f).length;
          const subs = flags.map((f, i) => makeSub(`c${i}`, f));
          for (const s of subs) h.gw.attach(s, "s1");
          // Client yang send history gagal tidak terdaftar.
          expect(h.gw.subscriberCount("s1")).toBe(healthy);

          msgIds.forEach((id, i) => {
            h.gw.notifyMessage("s1", makeMessage("s1", `${id}-${i}`, "assistant"));
          });

          flags.forEach((f, i) => {
            const s = subs[i];
            if (!s) return;
            if (f) {
              expect(s.sent.filter((m) => m.type === "message")).toHaveLength(0);
            } else {
              const msgs = s.sent.filter(
                (m): m is Extract<ServerMessage, { type: "message" }> => m.type === "message",
              );
              expect(msgs).toHaveLength(msgIds.length);
              expect(msgs.map((m) => m.message.id)).toEqual(msgIds.map((id, j) => `${id}-${j}`));
            }
          });
          expect(h.gw.subscriberCount("s1")).toBe(healthy);
        } finally {
          h.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
