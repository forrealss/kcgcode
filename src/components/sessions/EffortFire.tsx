/**
 * Efek api untuk `EffortSlider` saat thinking effort di tingkat tertinggi
 * (Max). Api HANYA di belakang card — card tetap utuh & terbaca; yang terlihat
 * hanya bagian yang mencuat dari balik tepinya:
 *
 * - `__glow`  : cahaya oranye berdenyut di sekeliling card.
 * - `__flames`: lidah api yang berpangkal sedikit di bawah tepi atas card —
 *               pangkalnya tertutup card, nyalanya mencuat di atas tepi atas.
 *               Dua baris (belakang: merah, besar, lambat; depan: kuning-
 *               oranye, cepat) + lidah sisi yang berpangkal lebih rendah dan
 *               menjilat kedua sisi card.
 * - `__sparks`: percikan bara yang muncul dari balik tepi atas lalu melayang.
 *
 * `-z-10` (pembungkus card TIDAK `isolate`): tergambar di belakang seluruh isi
 * dialog — stacking context-nya `DialogContent` (fixed) — tetapi di atas latar
 * dialog. Jadi api juga lewat di belakang elemen di atas card (mis. pilihan
 * agent), tidak pernah menutupi teks/kontrol.
 *
 * Bentuk lidah api acak-tapi-tetap (tabel di bawah) — tanpa `Math.random`
 * saat render. Liukan api dari filter SVG turbulence: noise statis yang
 * dilewati lidah api yang bergerak -> bentuknya berubah-ubah seperti api.
 * Gerakan di CSS `.effort-fire*` (styles/globals.css); reduced motion ->
 * api diam tanpa percikan.
 */
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { CSSProperties } from "react";
import { useId } from "react";

interface Tongue {
  /** Posisi horizontal (% lebar lapisan api, sedikit lebih lebar dari card). */
  x: number;
  /** Lebar & tinggi (% lebar / tinggi lapisan api). */
  w: number;
  h: number;
  /** Geser pangkal dari dasar lapisan (% tinggi lapisan; negatif = lebih rendah). */
  b?: number;
  /** Durasi & jeda (detik). */
  d: number;
  delay: number;
}

/** Baris belakang: lidah besar & lambat — memberi kedalaman. */
const BACK: Tongue[] = [
  { x: 3, w: 15, h: 92, d: 2.1, delay: 0.3 },
  { x: 21, w: 17, h: 100, d: 2.4, delay: 1.1 },
  { x: 40, w: 15, h: 90, d: 2.2, delay: 0.6 },
  { x: 59, w: 17, h: 104, d: 2.5, delay: 0 },
  { x: 78, w: 15, h: 94, d: 2.3, delay: 0.9 },
  { x: 97, w: 15, h: 90, d: 2.0, delay: 0.4 },
];

/** Baris depan: lidah ramping & cepat — nyala utama. */
const FRONT: Tongue[] = [
  { x: 4, w: 9, h: 66, d: 1.2, delay: 0.5 },
  { x: 11, w: 10, h: 78, d: 1.35, delay: 0.1 },
  { x: 18, w: 8, h: 60, d: 1.05, delay: 0.8 },
  { x: 25, w: 11, h: 84, d: 1.45, delay: 0.35 },
  { x: 32, w: 9, h: 64, d: 1.15, delay: 0.95 },
  { x: 39, w: 10, h: 76, d: 1.3, delay: 0.2 },
  { x: 47, w: 12, h: 88, d: 1.5, delay: 0.65 },
  { x: 55, w: 9, h: 62, d: 1.1, delay: 0 },
  { x: 62, w: 11, h: 82, d: 1.4, delay: 0.45 },
  { x: 69, w: 9, h: 66, d: 1.2, delay: 0.85 },
  { x: 76, w: 10, h: 78, d: 1.35, delay: 0.15 },
  { x: 83, w: 8, h: 60, d: 1.05, delay: 0.55 },
  { x: 90, w: 10, h: 74, d: 1.25, delay: 0.75 },
  { x: 96, w: 9, h: 64, d: 1.15, delay: 0.3 },
];

/** Lidah sisi: berpangkal di sekitar tengah card, menjilat ke atas di luar
 *  tepi kiri & kanan. */
const SIDES: Tongue[] = [
  { x: 0, w: 7, h: 120, b: -60, d: 1.5, delay: 0.2 },
  { x: 1, w: 6, h: 96, b: -45, d: 1.2, delay: 0.9 },
  { x: 99, w: 6, h: 96, b: -45, d: 1.25, delay: 0.1 },
  { x: 100, w: 7, h: 120, b: -60, d: 1.6, delay: 0.6 },
];

/** Percikan: posisi awal, geser samping (px), tinggi naik (px), durasi, jeda. */
const SPARKS = [
  { x: 8, dx: -10, rise: 80, d: 2, delay: 0 },
  { x: 19, dx: 8, rise: 105, d: 2.4, delay: 0.9 },
  { x: 31, dx: -6, rise: 70, d: 1.9, delay: 1.7 },
  { x: 44, dx: 12, rise: 115, d: 2.6, delay: 0.4 },
  { x: 56, dx: -12, rise: 85, d: 2.1, delay: 2.1 },
  { x: 68, dx: 6, rise: 110, d: 2.5, delay: 1.3 },
  { x: 80, dx: -8, rise: 75, d: 2, delay: 0.6 },
  { x: 92, dx: 10, rise: 95, d: 2.3, delay: 1.9 },
];

function tongueStyle(t: Tongue): CSSProperties {
  return {
    "--x": `${t.x}%`,
    "--w": `${t.w}%`,
    "--h": `${t.h}%`,
    "--b": `${t.b ?? 0}%`,
    "--d": `${t.d}s`,
    "--delay": `${t.delay}s`,
  } as CSSProperties;
}

export function EffortFire({ active }: { active: boolean }) {
  // `useId` bisa mengandung karakter yang merusak `url(#...)` — bersihkan.
  const filterId = `effort-fire-${useId().replace(/[^\w-]/g, "")}`;

  return (
    <AnimatePresence>
      {active && (
        <m.div
          key="effort-fire"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: "easeOut" } }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="effort-fire pointer-events-none absolute inset-0 -z-10"
        >
          <svg aria-hidden width="0" height="0" className="absolute">
            <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.035 0.09"
                numOctaves={2}
                seed={7}
              />
              <feDisplacementMap in="SourceGraphic" scale={16} />
            </filter>
          </svg>

          <div className="effort-fire__glow" />
          <div className="effort-fire__flames" style={{ filter: `url(#${filterId})` }}>
            {BACK.map((t) => (
              <span
                key={`b${t.x}`}
                className="effort-fire__tongue effort-fire__tongue--back"
                style={tongueStyle(t)}
              />
            ))}
            {[...SIDES, ...FRONT].map((t) => (
              <span
                key={`${t.b ? "s" : "f"}${t.x}`}
                className="effort-fire__tongue"
                style={tongueStyle(t)}
              />
            ))}
          </div>
          <div className="effort-fire__sparks">
            {SPARKS.map((s) => (
              <span
                key={s.x}
                className="effort-fire__spark"
                style={
                  {
                    "--x": `${s.x}%`,
                    "--dx": `${s.dx}px`,
                    "--rise": `${s.rise}px`,
                    "--d": `${s.d}s`,
                    "--delay": `${s.delay}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
