/**
 * Kartu pertanyaan (question) — render statis: struktur, teks, dan
 * aksesibilitas. Bentuk respon tiap interaksi diverifikasi di browser.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InteractivePrompt, PromptQuestion } from "@/types";
import { PromptCard } from "../PromptCard";

const opts = [
  { label: "Permission prompt fiktif", description: "Contoh permintaan izin tool." },
  { label: "JSON-RPC / format API", description: "Struktur payload JSON contoh." },
  { label: "Script nyata", description: null },
];

function question(over: Partial<InteractivePrompt> = {}): InteractivePrompt {
  return {
    id: "que_1",
    sessionId: "s1",
    kind: "question",
    type: "menu",
    title: "Simulasi permission tool yang seperti apa yang kamu mau?",
    options: opts,
    custom: true,
    status: "pending",
    createdAt: 0,
    resolvedAt: null,
    ...over,
  };
}

function html(p: InteractivePrompt, docked = false): string {
  return renderToStaticMarkup(<PromptCard prompts={[p]} onResolve={() => {}} docked={docked} />);
}

describe("QuestionCard — single choice", () => {
  test("judul = pertanyaannya sendiri (bukan label 'Question'), teks biasa bukan monospace", () => {
    const out = html(question());
    expect(out).toContain("Simulasi permission tool yang seperti apa yang kamu mau?");
    expect(out).not.toContain(">Question<");
    expect(out).not.toContain("Pick one of the options");
    // Pertanyaan tidak lagi ditampilkan dalam kotak font-mono.
    expect(out).not.toMatch(/font-mono[^>]*>Simulasi/);
  });

  test("opsi: label + keterangan, petunjuk 'ketuk untuk menjawab', tanpa tombol Submit", () => {
    const out = html(question());
    for (const o of opts) expect(out).toContain(o.label);
    expect(out).toContain("Contoh permintaan izin tool.");
    expect(out).toContain("Tap an option to answer");
    expect(out).not.toContain(">Submit<");
  });

  test("opsi bernomor + pintasan angka 1..n", () => {
    const out = html(question());
    expect(out).toContain('aria-keyshortcuts="1"');
    expect(out).toContain('aria-keyshortcuts="3"');
    expect(out).not.toContain('aria-keyshortcuts="4"');
  });

  test("selalu ada Skip untuk menolak tanpa memilih", () => {
    expect(html(question())).toContain(">Skip<");
  });

  test("jawaban bebas: input berlabel + tombol kirim", () => {
    const out = html(question());
    expect(out).toContain('placeholder="Type your own answer…"');
    expect(out).toContain('aria-label="Send your answer"');
    // React SSR mempertahankan nama prop apa adanya (`enterKeyHint`).
    expect(out.toLowerCase()).toContain('enterkeyhint="send"');
  });

  test("custom=false -> tanpa input jawaban bebas", () => {
    expect(html(question({ custom: false }))).not.toContain("Type your own answer");
  });

  test("aksesibilitas: dialog berlabel judul pertanyaan", () => {
    const out = html(question());
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-labelledby="q-que_1-title"');
  });
});

describe("QuestionCard — multi-select", () => {
  test("checkbox per opsi + tombol Submit; jawaban bebas ikut Submit (tanpa tombol kirim sendiri)", () => {
    const out = html(question({ multiple: true }));
    expect(out.match(/role="checkbox"/g)).toHaveLength(opts.length);
    expect(out).toContain("Select all that apply");
    expect(out).toContain(">Submit<");
    expect(out).not.toContain('aria-label="Send your answer"');
  });

  test("Submit nonaktif sampai ada pilihan", () => {
    expect(html(question({ multiple: true }))).toMatch(/disabled=""[^>]*>Submit</);
  });
});

describe("QuestionCard — multi-question", () => {
  const qs: PromptQuestion[] = [
    {
      question: "Bahasa apa?",
      header: "Language",
      options: [
        { label: "TS", description: null },
        { label: "Go", description: null },
      ],
      multiple: false,
    },
    {
      question: "Fitur apa saja?",
      options: [
        { label: "Auth", description: null },
        { label: "Logs", description: null },
      ],
      multiple: true,
    },
  ];

  test("wizard: judul ringkas + posisi langkah + indikator per pertanyaan", () => {
    const out = html(question({ questions: qs }));
    expect(out).toContain("The agent has 2 questions");
    expect(out).toContain("Question 1 of 2 · 0 answered");
    expect(out).toContain('aria-label="Questions"');
    expect(out).toContain('aria-current="step"');
    // Label segmen memakai header pertanyaan bila ada.
    expect(out).toContain('aria-label="Language"');
    expect(out).toContain('aria-label="Question 2"');
  });

  test("wizard: semua langkah ditumpuk (tinggi stabil), hanya langkah aktif yang interaktif", () => {
    const out = html(question({ questions: qs }));
    // Kedua langkah ada di DOM dalam satu sel grid -> tinggi kartu tetap.
    expect(out).toContain("Bahasa apa?");
    expect(out).toContain("Fitur apa saja?");
    expect(out.match(/col-start-1 row-start-1/g)).toHaveLength(2);
    // Langkah 2 (bukan aktif) tidak bisa difokus & disembunyikan dari AT.
    const step2 = out.slice(out.indexOf('aria-labelledby="q-que_1-1"') - 200);
    expect(step2).toMatch(/inert=""/);
    expect(step2).toMatch(/aria-hidden="true"/);
    // Langkah 1 single = radio, langkah 2 multiple = checkbox.
    expect(out.match(/role="radio"/g)).toHaveLength(2);
    expect(out.match(/role="checkbox"/g)).toHaveLength(2);
  });

  test("wizard langkah pertama: Back nonaktif, Next nonaktif sampai dijawab, belum ada Submit", () => {
    const out = html(question({ questions: qs }));
    expect(out).toMatch(/disabled=""[^>]*aria-label="Previous question"/);
    expect(out).toMatch(/disabled=""[^>]*>Next/);
    expect(out).not.toContain("Submit answers");
    expect(out).toContain(">Skip<");
  });

  test("wizard: pintasan angka hanya pada langkah aktif", () => {
    const out = html(question({ questions: qs }));
    // Langkah aktif punya 2 opsi -> masing-masing 1x; langkah lain tanpa.
    expect(out.match(/aria-keyshortcuts="1"/g)).toHaveLength(1);
    expect(out.match(/aria-keyshortcuts="2"/g)).toHaveLength(1);
  });
});

test("docked: daftar jawaban jadi area scroll, footer tetap di luar", () => {
  const out = html(question(), true);
  expect(out).toContain("overflow-y-auto");
  // Footer (Skip) berada SETELAH area jawaban yang scroll.
  expect(out.indexOf("overflow-y-auto")).toBeLessThan(out.indexOf(">Skip<"));
});
