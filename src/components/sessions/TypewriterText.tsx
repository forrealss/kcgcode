/**
 * TypewriterText — efek "mengetik" untuk teks jawaban.
 *
 * Latar belakang: beberapa provider model (mis. mimo/kcgrouter) TIDAK
 * men-stream token teks lewat SSE (`message.part.updated` untuk part text
 * datang kosong, lalu teks penuh melompat di akhir). Agar jawaban terasa
 * diketik bertahap — bukan muncul sekaligus — frontend mereveal teks perlahan
 * dengan cursor berkedip.
 *
 * Komponen ini FALLBACK: bila provider benar-benar men-stream teks (part text
 * bertambah bertahap), pesan live ditampilkan apa adanya tanpa animasi
 * (parent memilih `active: false`); typewriter hanya dipakai saat teks datang
 * sekaligus di pesan final.
 *
 * - `active`: true untuk pesan baru yang teksnya datang sekaligus (mulai dari
 *   kosong), false untuk pesan lama/reattach/streaming-live (tampil penuh).
 * - Durasi adaptif terhadap panjang teks (`typewriterTiming`): teks pendek
 *   selesai cepat, teks panjang dibatasi agar tidak molor terlalu lama.
 */
import { useEffect, useRef, useState } from "react";

/** Batas total durasi mengetik (ms) agar teks sangat panjang tidak molor. */
export const TYPEWRITER_TARGET_MS = 2400;

/**
 * Timing typewriter (murni, diuji): interval tick tetap, jumlah karakter per
 * tick dihitung agar seluruh teks selesai kira-kira dalam `TYPEWRITER_TARGET_MS`.
 *
 * `tickMs` 33 (~30fps), bukan 16: teks yang direveal kini dirender sebagai
 * Markdown, sehingga setiap tick memicu satu parse ulang. Menyetengahkan
 * jumlah tick memotong biaya parse tanpa terasa tersendat.
 */
export function typewriterTiming(textLength: number): { tickMs: number; charsPerTick: number } {
  const tickMs = 33;
  if (textLength <= 0) return { tickMs, charsPerTick: 1 };
  const ticks = Math.max(1, Math.floor(TYPEWRITER_TARGET_MS / tickMs));
  const charsPerTick = Math.max(1, Math.ceil(textLength / ticks));
  return { tickMs, charsPerTick };
}

export interface TypewriterTextProps {
  text: string;
  /** Aktifkan animasi mengetik (pesan baru). Pesan lama dirender penuh. */
  active: boolean;
  className?: string;
  /**
   * Render potongan teks yang sudah terungkap. Dipakai agar pemanggil dapat
   * merender Markdown (bukan teks polos) sambil animasi berjalan; `typing`
   * menandai animasi masih berlangsung sehingga kursor dapat ditempel.
   * Tanpa ini, teks dirender apa adanya di dalam `<span>`.
   */
  children?: (shown: string, typing: boolean) => React.ReactNode;
}

export function TypewriterText({ text, active, className, children }: TypewriterTextProps) {
  // Hormati prefers-reduced-motion: teks langsung penuh, tanpa animasi.
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const [shown, setShown] = useState(() => (active ? "" : text));
  /**
   * Pasangan (text, active) terakhir yang sudah diproses. `textOf` di parent
   * menghasilkan string baru tiap render (join), sehingga deps `[text, active]`
   * bisa terpicu walau isinya sama — guard ini mencegah animasi restart.
   */
  const prev = useRef<{ text: string; active: boolean }>({ text: "", active: false });

  useEffect(() => {
    if (prev.current.text === text && prev.current.active === active) return;
    prev.current = { text, active };

    if (!active || reducedMotion) {
      setShown(text);
      return;
    }
    setShown("");
    if (text.length === 0) return;
    const { tickMs, charsPerTick } = typewriterTiming(text.length);
    let i = 0;
    const id = setInterval(() => {
      i += charsPerTick;
      if (i >= text.length) {
        setShown(text);
        clearInterval(id);
      } else {
        setShown(text.slice(0, i));
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [text, active, reducedMotion]);

  const typing = active && shown.length < text.length;

  // Render kustom (mis. Markdown) bila disediakan pemanggil.
  if (children) return <>{children(shown, typing)}</>;

  return (
    <span className={className}>
      {shown}
      {typing && <span className="animate-pulse">▍</span>}
    </span>
  );
}
