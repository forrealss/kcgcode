/**
 * Dekorasi latar headline homepage ala "blueprint": garis tipis memancar dari
 * logo, garis bantu dengan tick penggaris, lingkar putus-putus yang berputar
 * pelan, dan anotasi rumus kecil (E = mc²) — agar sambutan tidak terasa datar.
 *
 * - Murni dekoratif (`aria-hidden`, tanpa pointer). Titik (0, 0) SVG = pusat
 *   logo, jadi ikut posisi logo di HP (bertumpuk) maupun desktop (sebaris).
 * - `-z-10` di dalam root HomeChat yang `isolate`: tergambar di belakang
 *   headline & composer — kotak composer menutup garis di belakangnya.
 * - Garis memudar ke tepi lewat <mask> radial; label tidak ikut dimask.
 * - `currentColor` + opacity rendah -> pas di tema terang & gelap. Bagian
 *   yang melebihi lebar layar HP terpotong `<main>` (overflow-x-hidden).
 * - Label punya dua posisi: lebar (sm+) jauh di samping, sempit (HP) lebih
 *   dekat ke logo agar tetap di dalam layar.
 */
import { useId } from "react";

const W = 760;
const H = 400;

/** Sudut sinar (derajat, 0 = kanan, negatif = ke atas). Bawah dibiarkan
 *  kosong agar daftar Session terbaru tetap bersih. */
const RAYS = [-171, -152, -133, -114, -96, -66, -47, -29, -12, 9, 168];

function ray(deg: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (deg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  return { x1: cos * 44, y1: sin * 44, x2: cos * 440, y2: sin * 440 };
}

/** Tick penggaris di garis bantu atas. */
const TICKS = Array.from({ length: 9 }, (_, i) => 72 + i * 36);

function Label({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text x={x} y={y} fontSize={12} letterSpacing="0.06em" fill="currentColor">
      {children}
    </text>
  );
}

export function HomeBackdrop() {
  // `useId` bisa mengandung karakter yang merusak `url(#...)` — bersihkan.
  const id = useId().replace(/[^\w-]/g, "");
  const fade = `home-backdrop-fade-${id}`;
  const mask = `home-backdrop-mask-${id}`;

  return (
    <svg
      aria-hidden
      width={W}
      height={H}
      viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
      className="pointer-events-none absolute top-1/2 left-1/2 -z-10 max-w-none -translate-x-1/2 -translate-y-1/2 text-foreground animate-in fade-in duration-1000"
    >
      <defs>
        {/* Elips selebar SVG: pekat di sekitar logo, hilang di tepi. */}
        <radialGradient
          id={fade}
          cx={0}
          cy={0}
          r={W / 2}
          gradientUnits="userSpaceOnUse"
          gradientTransform={`scale(1 ${H / W})`}
        >
          <stop offset="0.12" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={mask}>
          <rect x={-W / 2} y={-H / 2} width={W} height={H} fill={`url(#${fade})`} />
        </mask>
      </defs>

      <g mask={`url(#${mask})`} stroke="currentColor" strokeWidth={1} fill="none">
        <g strokeOpacity={0.13}>
          {RAYS.map((deg) => (
            <line key={deg} {...ray(deg)} />
          ))}
        </g>

        <g strokeOpacity={0.24}>
          {/* Garis bantu: vertikal di atas logo, horizontal kanan-atas &
              kiri-bawah (seperti garis lintang/bujur pada peta). */}
          <line x1={0} y1={-H / 2} x2={0} y2={-40} />
          <line x1={36} y1={-36} x2={W / 2} y2={-36} />
          <line x1={-36} y1={30} x2={-W / 2} y2={30} />
          {TICKS.map((x) => (
            <line key={x} x1={x} y1={-36} x2={x} y2={-36 + (x % 72 === 0 ? -6 : -3)} />
          ))}
        </g>

        {/* Lingkar orbit — berputar sangat pelan (dimatikan bila pengguna
            memilih reduced motion, lihat src/index.css). */}
        <circle
          r={60}
          strokeOpacity={0.3}
          strokeDasharray="2 6"
          className="origin-center animate-spin [transform-box:fill-box]"
          style={{ animationDuration: "80s" }}
        />
        <circle r={112} strokeOpacity={0.1} />
      </g>

      <g className="font-mono" fillOpacity={0.5}>
        <g className="hidden sm:inline">
          <Label x={280} y={-44}>
            E = mc²
          </Label>
          <Label x={-320} y={22}>
            ΔxΔp ≥ ħ/2
          </Label>
        </g>
        <g className="sm:hidden">
          <Label x={52} y={-44}>
            E = mc²
          </Label>
          <Label x={-170} y={22}>
            ΔxΔp ≥ ħ/2
          </Label>
        </g>
      </g>
    </svg>
  );
}
