/**
 * Tata letak composer: inline (textarea sebaris dengan tombol) atau stacked
 * (textarea di baris sendiri, tombol aksi & kirim/stop turun ke bawahnya —
 * ala Gemini), plus tinggi textarea yang tumbuh mengikuti isi.
 *
 * Keputusan stacked diambil dari LEBAR teks satu baris (span pengukur
 * tersembunyi) terhadap lebar form, bukan dari tinggi textarea — lihat
 * `updateMultiline`. Lebar form dipantau `ResizeObserver`.
 */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface UseStackedLayoutOptions {
  /** Isi input — tiap perubahan mengukur ulang lebar teks & tinggi textarea. */
  text: string;
  /** Jumlah lampiran — pemicu ukur ulang (tombol kirim muncul/hilang). */
  attachmentCount: number;
  /** Layar sempit (mobile): baris inline hanya berisi tiga tombol. */
  compact: boolean;
  /** Textarea composer (tinggi otomatis). Ref milik composer. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export interface StackedLayout {
  /**
   * Input butuh lebih dari satu baris — tombol aksi & kirim/stop pindah ke
   * baris di bawah textarea (ala Gemini), di desktop maupun mobile.
   */
  multiline: boolean;
  /** Pasang ke `<form>` composer: acuan lebar baris (dipantau ResizeObserver). */
  formRef: RefObject<HTMLFormElement | null>;
  /** Pasang ke span pengukur lebar teks satu baris — font identik dengan textarea. */
  measureRef: RefObject<HTMLSpanElement | null>;
}

export function useStackedLayout({
  text,
  attachmentCount,
  compact,
  textareaRef,
}: UseStackedLayoutOptions): StackedLayout {
  const [multiline, setMultiline] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  /** Pengukur lebar teks satu baris — font identik dengan textarea. */
  const measureRef = useRef<HTMLSpanElement | null>(null);
  /**
   * Perkiraan lebar kontrol yang berbagi baris dengan textarea saat inline —
   * SENGAJA dilebihkan (attach + agent + mic + kirim di desktop; plus + mic +
   * kirim di mobile) agar teks di dekat batas selalu dianggap multiline,
   * bukan pas-pasan (sumber flip-flop). Mobile lebih kecil karena barisnya
   * hanya tiga tombol.
   */
  const INLINE_CONTROLS_RESERVE_PX = compact ? 128 : 232;
  /**
   * Putuskan `multiline` dari LEBAR TEKS terhadap lebar baris inline — BUKAN
   * dari scrollHeight textarea. Mengukur tinggi membuat keputusan bergantung
   * pada layout AKTIF: teks yang wrap di baris inline (sempit, dipotong
   * tombol) bisa muat satu baris saat stacked (lebar penuh) → stacked →
   * remeasure muat → inline → wrap lagi → … (flip-flop tiap ketik). Lebar
   * teks (span tersembunyi) vs lebar form TIDAK berubah saat layout
   * berganti, sehingga keputusannya selalu titik tetap yang stabil.
   */
  const updateMultiline = useCallback(() => {
    const span = measureRef.current;
    const form = formRef.current;
    if (span === null || form === null) return;
    const inlineTextWidth =
      form.clientWidth -
      16 /* p-2 kontainer */ -
      16 /* px-2 textarea */ -
      INLINE_CONTROLS_RESERVE_PX;
    setMultiline(span.scrollWidth > inlineTextWidth);
  }, [INLINE_CONTROLS_RESERVE_PX]);
  /**
   * Tumbuhkan tinggi textarea mengikuti isi (maks lewat CSS max-h). Textarea
   * KOSONG dikembalikan ke tinggi CSS-nya (satu baris): di beberapa browser
   * `scrollHeight` ikut menghitung placeholder yang wrap, sehingga textarea
   * kosong tumbuh dua baris & jadi scrollable (mis. saat lampiran gambar
   * mempersempit ruang teks).
   */
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    if (el.value === "") return;
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  // Sinkronkan pengukur lebar + keputusan stacked + tinggi textarea untuk
  // perubahan `text` apa pun (ketik, autocomplete @file, reset kirim).
  // biome-ignore lint/correctness/useExhaustiveDependencies: jumlah lampiran jadi pemicu (tombol kirim muncul -> lebar textarea berubah)
  useLayoutEffect(() => {
    const span = measureRef.current;
    if (span !== null) span.textContent = text;
    updateMultiline();
    if (textareaRef.current) autoResize(textareaRef.current);
    // Lampiran menambah/menghapus tombol kirim -> lebar textarea berubah.
  }, [text, attachmentCount, updateMultiline, autoResize, textareaRef]);
  // Lebar form berubah (resize window / orientasi HP) → keputusan stacked
  // dihitung ulang terhadap lebar terbaru.
  useEffect(() => {
    const form = formRef.current;
    if (form === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateMultiline);
    observer.observe(form);
    return () => observer.disconnect();
  }, [updateMultiline]);

  return { multiline, formRef, measureRef };
}
