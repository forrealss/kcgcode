/**
 * Nada hover rail pesan (Web Audio) — tangga nada mayor.
 *
 * Penanda paling atas berbunyi paling rendah, makin ke bawah makin tinggi
 * (do re mi fa sol la si do…), berhenti menaik setelah dua oktaf.
 * Frekuensinya dihitung murni (`scaleFrequency`, bisa diuji); pemutarannya
 * memakai satu `AudioContext` bersama.
 *
 * Catatan browser: `AudioContext` baru boleh berbunyi setelah ada interaksi
 * yang dianggap "user activation" (klik / tap / tombol). Hover TIDAK termasuk,
 * jadi nada pertama bisa senyap sampai pengguna mengklik sesuatu di halaman.
 * Karena ini hanya hiasan, kegagalan diabaikan diam-diam.
 */

/** Jarak semiton nada mayor: do re mi fa sol la si. */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

/** Nada dasar (C4). */
export const BASE_FREQUENCY = 261.63;

/**
 * Nada tertinggi = dua oktaf di atas dasar (do), yaitu derajat ke-14 tangga
 * nada. Di atas itu nada DITAHAN (tidak berulang ke bawah): rail panjang
 * tetap terdengar menaik, dan nadanya tidak pernah melengking (maks ±1 kHz).
 */
const MAX_DEGREE = 14;

/**
 * Frekuensi (Hz) untuk penanda ke-`index` (0 = paling atas / paling rendah).
 * Naik satu derajat tangga nada mayor per penanda, ditahan di `MAX_DEGREE`.
 */
export function scaleFrequency(index: number, base = BASE_FREQUENCY): number {
  const degree = Math.min(Math.max(0, Math.floor(index)), MAX_DEGREE);
  const step = MAJOR_STEPS[degree % MAJOR_STEPS.length] ?? 0;
  const octave = Math.floor(degree / MAJOR_STEPS.length);
  return base * 2 ** ((step + octave * 12) / 12);
}

type Ctx = AudioContext & { _kcgUnlocked?: boolean };
let ctx: Ctx | null = null;

function audioContext(): Ctx | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * Bunyikan satu nada pendek & lembut. Tidak pernah melempar: fitur ini
 * sekadar umpan balik, bukan bagian dari alur utama.
 */
export function playTone(frequency: number): void {
  try {
    const audio = audioContext();
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();
    if (audio.state !== "running") return;

    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    // Triangle: lembut, tanpa harmonik tajam seperti square/saw.
    osc.type = "triangle";
    osc.frequency.value = frequency;
    // Envelope pendek (±0.16 s) dengan attack cepat supaya terasa seperti
    // "tik" bernada, bukan bunyi panjang yang mengganggu saat menyapu rail.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    /* Web Audio tidak tersedia / diblokir — abaikan. */
  }
}
