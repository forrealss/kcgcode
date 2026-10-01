/**
 * Kerangka loading percakapan — render statis.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionComposerSkeleton, SessionTimelineSkeleton } from "../SessionTimelineSkeleton";

test("kerangka timeline: status berlabel untuk pembaca layar, bukan empty-state", () => {
  const out = renderToStaticMarkup(<SessionTimelineSkeleton />);
  expect(out).toContain('role="status"');
  expect(out).toContain('aria-label="Loading conversation"');
  expect(out).not.toContain("No conversation yet");
  // Gelembung user (kanan) + baris jawaban assistant.
  expect(out).toContain("ml-auto");
  expect(out.match(/data-slot="skeleton"/g)?.length).toBeGreaterThanOrEqual(5);
});

test("kerangka muncul setelah jeda (anti kedip) dan menghormati reduced motion", () => {
  const out = renderToStaticMarkup(<SessionTimelineSkeleton />);
  expect(out).toContain("delay-150");
  expect(out).toContain("motion-reduce:animate-none");
});

test("kerangka composer meniru composer asli: kotak p-2 + baris setinggi size-9", () => {
  const out = renderToStaticMarkup(<SessionComposerSkeleton />);
  expect(out).toContain("max-w-[46rem]");
  expect(out).toContain("rounded-xl border");
  expect(out).toContain("p-2");
  expect(out.match(/size-9/g)).toHaveLength(2);
  // Tidak ada tinggi tetap yang lebih besar dari composer asli.
  expect(out).not.toMatch(/h-\[6\.5rem\]/);
});
