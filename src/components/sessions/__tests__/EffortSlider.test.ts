import { expect, test } from "bun:test";
import { shakeKeyframes } from "../EffortSlider";

/** Geser horizontal (px) tiap keyframe. */
function offsets(frames: Keyframe[]): number[] {
  return frames.map((f) => Number(/translateX\((-?[\d.]+)px\)/.exec(String(f.transform))?.[1]));
}

test("getaran mulai & berakhir di posisi semula, hentakan pertama searah perubahan", () => {
  const up = offsets(shakeKeyframes(1, 0.5));
  const down = offsets(shakeKeyframes(-1, 0.5));
  expect(up[0]).toBe(0);
  expect(up.at(-1)).toBe(0);
  expect(up[1]).toBeGreaterThan(0);
  expect(down[1]).toBeLessThan(0);
});

test("tingkat lebih tinggi -> getaran lebih kuat", () => {
  const low = Math.max(...offsets(shakeKeyframes(1, 0)).map(Math.abs));
  const max = Math.max(...offsets(shakeKeyframes(1, 1)).map(Math.abs));
  expect(low).toBe(1.5);
  expect(max).toBe(4);
});
