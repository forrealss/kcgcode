import { describe, expect, test } from "bun:test";
import { BASE_FREQUENCY, scaleFrequency } from "../tone";

describe("scaleFrequency", () => {
  test("penanda pertama = nada dasar, makin ke bawah makin tinggi", () => {
    expect(scaleFrequency(0)).toBeCloseTo(BASE_FREQUENCY, 2);
    const freqs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => scaleFrequency(i));
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1] as number);
    }
  });

  test("nada mayor: langkah ke-3 (fa) = 5 semiton, oktaf penuh = 2x dasar", () => {
    expect(scaleFrequency(3)).toBeCloseTo(BASE_FREQUENCY * 2 ** (5 / 12), 2);
    expect(scaleFrequency(7)).toBeCloseTo(BASE_FREQUENCY * 2, 2);
  });

  test("ditahan di dua oktaf: tidak melengking & tidak turun lagi", () => {
    // Derajat ke-14 = do dua oktaf di atas dasar; di atas itu nadanya sama.
    expect(scaleFrequency(14)).toBeCloseTo(BASE_FREQUENCY * 4, 2);
    expect(scaleFrequency(20)).toBeCloseTo(scaleFrequency(14), 2);
    expect(scaleFrequency(1000)).toBeCloseTo(scaleFrequency(14), 2);
    // Tidak pernah menurun (rail panjang tetap terasa menaik).
    let prev = 0;
    for (let i = 0; i < 40; i++) {
      const f = scaleFrequency(i);
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f).toBeLessThanOrEqual(BASE_FREQUENCY * 4 + 0.01);
      prev = f;
    }
  });

  test("index negatif / pecahan tetap aman", () => {
    expect(scaleFrequency(-5)).toBeCloseTo(BASE_FREQUENCY, 2);
    expect(scaleFrequency(1.9)).toBeCloseTo(scaleFrequency(1), 2);
  });
});
