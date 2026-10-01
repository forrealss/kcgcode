/** Smoke: rail penanda pesan user (render, ambang minimum, aksesibilitas). */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageRail, type UserMessageMark } from "../MessageRail";

function html(marks: UserMessageMark[], activeId: string | null = null): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MessageRail marks={marks} activeId={activeId} onJump={() => {}} />
    </TooltipProvider>,
  );
}

test("satu pesan user -> rail tidak dirender (tidak berguna)", () => {
  expect(html([{ id: "a", preview: "halo" }])).toBe("");
  expect(html([])).toBe("");
});

test("dua pesan user -> satu penanda per pesan + label lompat", () => {
  const out = html([
    { id: "a", preview: "pesan pertama" },
    { id: "b", preview: "pesan kedua" },
  ]);
  expect(out.match(/<button/g)).toHaveLength(2);
  expect(out).toContain("Jump to your message 1: pesan pertama");
  expect(out).toContain("Jump to your message 2: pesan kedua");
  expect(out).toContain('aria-label="Your messages"');
});

test("penanda aktif ditandai aria-current", () => {
  const out = html(
    [
      { id: "a", preview: "satu" },
      { id: "b", preview: "dua" },
    ],
    "b",
  );
  expect(out.match(/aria-current="true"/g)).toHaveLength(1);
});
