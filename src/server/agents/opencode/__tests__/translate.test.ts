/**
 * Penerjemah event opencode v2 -> `AgentEvent` (`translate.ts`): event yang
 * dipakai diteruskan, sisanya dibuang; `form.created` dinormalkan.
 */
import { describe, expect, test } from "bun:test";
import { toAgentForm, translateOpencodeEvent } from "../translate";

describe("translateOpencodeEvent", () => {
  test("event yang dipakai diteruskan apa adanya beserta location", () => {
    const raw = {
      id: "evt_1",
      type: "session.text.delta",
      location: { directory: "/proj" },
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "Hi" },
    };
    expect(translateOpencodeEvent(raw)).toEqual({
      type: "session.text.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "Hi" },
      location: { directory: "/proj" },
    });
  });

  test("event tak dipakai / tanpa sessionID dibuang", () => {
    expect(translateOpencodeEvent({ type: "server.connected", data: {} })).toBeNull();
    expect(translateOpencodeEvent({ type: "model.updated", data: {} })).toBeNull();
    expect(translateOpencodeEvent({ type: "session.text.delta", data: { delta: "x" } })).toBeNull();
    expect(translateOpencodeEvent("rusak")).toBeNull();
  });

  test("form.created dinormalkan ke AgentForm (opsi, custom, hidden)", () => {
    const ev = translateOpencodeEvent({
      type: "form.created",
      data: {
        form: {
          id: "frm_1",
          sessionID: "ses_1",
          title: "Questions",
          metadata: { kind: "question" },
          fields: [
            {
              key: "q0",
              title: "Color",
              description: "Which color?",
              type: "string",
              options: [{ value: "red", label: "Red" }, { label: "Blue" }],
              custom: true,
            },
            { key: "bad" },
          ],
        },
      },
    });
    expect(ev).toEqual({
      type: "form.created",
      data: {
        form: {
          id: "frm_1",
          sessionID: "ses_1",
          title: "Questions",
          metadata: { kind: "question" },
          fields: [
            {
              key: "q0",
              type: "string",
              title: "Color",
              description: "Which color?",
              options: [
                { value: "red", label: "Red" },
                { value: "Blue", label: "Blue" },
              ],
              custom: true,
            },
          ],
        },
      },
    });
    expect(toAgentForm({ id: "x", sessionID: "s", fields: [] })).toBeNull();
  });
});
