/**
 * Unit test draf composer tersinkron (gateway + `drafts.ts`):
 * - attach mengirim snapshot draf (`origin: "server"`) setelah history.
 * - pesan `draft` dari Client disimpan & disiarkan ke semua koneksi Session
 *   (termasuk pengirim — klien menyaring lewat `origin`); draf yang sama
 *   tidak disiarkan ulang; draf tidak valid ditolak.
 * - draf kosong menghapus simpanan; Session dihapus -> drafnya ikut hilang.
 */
import { expect, test } from "bun:test";
import { type ComposerDraft, EMPTY_DRAFT } from "../../../../types";
import type { ServerMessage } from "../../../../ws-protocol";
import { parseDraft } from "../../drafts";
import { dispatchClientMessage } from "../../ws-transport";
import { freshHarness, makeSub } from "./harness";

type DraftMsg = Extract<ServerMessage, { type: "draft" }>;
const drafts = (sent: ServerMessage[]) => sent.filter((m): m is DraftMsg => m.type === "draft");

const IMG = "11111111-1111-1111-1111-111111111111";
const DRAFT: ComposerDraft = {
  text: "Make the header sticky",
  attachments: [{ id: IMG, name: "shot.jpg", mime: "image/jpeg", size: 1234 }],
  elements: [
    {
      label: 'button#save "Save"',
      context: "Selected element: `button#save`",
      key: '#save|<button id="save">',
      pages: ["/settings"],
    },
  ],
};

test("attach: snapshot draf dikirim setelah history", () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");
    const types = sub.sent.map((m) => m.type);
    expect(types.indexOf("history")).toBeLessThan(types.indexOf("draft"));
    expect(drafts(sub.sent)).toEqual([
      { type: "draft", sessionId: "s1", draft: EMPTY_DRAFT, origin: "server" },
    ]);
  } finally {
    h.close();
  }
});

test("draft dari Client: disimpan, disiarkan ke koneksi Session, tidak diulang bila sama", () => {
  const h = freshHarness();
  try {
    const app = makeSub("app");
    const overlay = makeSub("overlay");
    h.gw.attach(app, "s1");
    h.gw.attach(overlay, "s1");
    app.sent.length = 0;
    overlay.sent.length = 0;

    const msg = JSON.stringify({ type: "draft", sessionId: "s1", draft: DRAFT, origin: "tab-1" });
    dispatchClientMessage(h.gw, app, msg);
    const expected: DraftMsg = { type: "draft", sessionId: "s1", draft: DRAFT, origin: "tab-1" };
    expect(drafts(app.sent)).toEqual([expected]);
    expect(drafts(overlay.sent)).toEqual([expected]);
    expect(h.gw.getDraft("s1")).toEqual(DRAFT);

    // Isi sama -> tidak ada siaran baru.
    dispatchClientMessage(h.gw, app, msg);
    expect(drafts(overlay.sent)).toHaveLength(1);

    // Koneksi baru menerima isi draf sebagai snapshot.
    const late = makeSub("late");
    h.gw.attach(late, "s1");
    expect(drafts(late.sent)).toEqual([{ ...expected, origin: "server" }]);

    // Draf kosong (pesan terkirim) -> simpanan bersih, tetap disiarkan.
    h.gw.setDraft("s1", EMPTY_DRAFT, "overlay-1");
    expect(h.gw.getDraft("s1")).toEqual(EMPTY_DRAFT);
    expect(drafts(app.sent).at(-1)?.draft).toEqual(EMPTY_DRAFT);
  } finally {
    h.close();
  }
});

test("draft tidak valid / Session tak dikenal ditolak", () => {
  const h = freshHarness();
  try {
    const sub = makeSub("c1");
    h.gw.attach(sub, "s1");
    sub.sent.length = 0;
    const send = (body: unknown) => dispatchClientMessage(h.gw, sub, JSON.stringify(body));

    send({ type: "draft", sessionId: "s1", draft: { text: 1 }, origin: "tab" });
    send({ type: "draft", sessionId: "s1", draft: DRAFT, origin: "spasi tidak boleh" });
    expect(sub.sent.filter((m) => m.type === "error")).toHaveLength(2);

    send({ type: "draft", sessionId: "nope", draft: DRAFT, origin: "tab" });
    expect(h.gw.getDraft("nope")).toEqual(EMPTY_DRAFT);
    expect(drafts(sub.sent)).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("Session dihapus -> draf ikut dibuang", () => {
  const h = freshHarness();
  try {
    h.gw.setDraft("s1", DRAFT, "tab");
    h.gw.notifySessionDeleted("s1");
    expect(h.gw.getDraft("s1")).toEqual(EMPTY_DRAFT);
  } finally {
    h.close();
  }
});

test("parseDraft: batas & bentuk", () => {
  expect(parseDraft(DRAFT)).toEqual(DRAFT);
  expect(parseDraft(null)).toBeNull();
  expect(parseDraft({ ...DRAFT, text: "x".repeat(20_001) })).toBeNull();
  expect(
    parseDraft({ ...DRAFT, attachments: [{ ...DRAFT.attachments[0], id: "../etc" }] }),
  ).toBeNull();
  expect(parseDraft({ ...DRAFT, elements: Array(9).fill(DRAFT.elements[0]) })).toBeNull();
  // Klien lama tanpa key/pages: key = label, pages kosong.
  const { key: _k, pages: _p, ...legacy } = DRAFT.elements[0] as ComposerDraft["elements"][0];
  expect(parseDraft({ ...DRAFT, elements: [legacy] })?.elements).toEqual([
    { ...legacy, key: legacy.label, pages: [] },
  ]);
  expect(
    parseDraft({ ...DRAFT, elements: [{ ...DRAFT.elements[0], pages: Array(11).fill("/") }] }),
  ).toBeNull();
  // Properti tambahan dibuang (normalisasi).
  expect(parseDraft({ ...DRAFT, extra: true, elements: [{ ...DRAFT.elements[0], x: 1 }] })).toEqual(
    DRAFT,
  );
});
