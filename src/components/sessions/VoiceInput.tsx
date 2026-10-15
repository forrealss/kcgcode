/**
 * Tampilan dikte suara composer (`hooks/useSpeechToText.ts`):
 *
 * - `MicButton`: tombol mic di sebelah tombol kirim. Tidak dirender bila
 *   browser tak mendukung; nonaktif + keterangan di HTTP biasa.
 * - `VoiceDictationPill`: pengganti mic selama mendengarkan —
 *   `[✕ batal] [bar frekuensi] [✓ kirim sekarang]`; Esc = batal.
 * - `VoiceWaveform`: bar yang mengikuti suara mic. Tinggi = bentuk spektrum
 *   `AnalyserNode` (rendah di tengah, ala voice mode) × kenyaringan (RMS) —
 *   hening -> bar rata di bawah, bicara -> bar melonjak. Naik cepat, turun
 *   lebih pelan. Diperbarui lewat `requestAnimationFrame` langsung ke
 *   `style.transform` — tanpa render ulang React. Tanpa analyser (iOS / audio
 *   mic gagal) -> gelombang yang digerakkan `activity()` (kata baru dari
 *   pengenal suara), tetap bereaksi saat bicara.
 */
import { CheckIcon, MicIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { barLevels, type SpeechSupport, volumeLevel, waveformHeights } from "@/lib/speech";
import { cn } from "@/lib/utils";

const BARS = 20;
/** Tinggi minimum bar (proporsi) — bar tetap terlihat saat hening. */
const FLOOR = 0.14;
/** Kecepatan bar mengejar target per frame: naik cepat, turun pelan. */
const ATTACK = 0.55;
const RELEASE = 0.16;
/** Riak kecil saat menunggu suara (tanpa analyser). */
const IDLE = 0.12;

/** Bentuk gelombang pengganti tanpa data mic (simetris, puncak di tengah). */
function syntheticShape(bars: number, seconds: number): number[] {
  const mid = (bars - 1) / 2;
  return Array.from({ length: bars }, (_, i) => {
    const d = Math.abs(i - mid) / mid;
    const wave = Math.sin(seconds * 9 - d * 5) * 0.5 + 0.5;
    return (0.35 + wave * 0.65) * (1 - d * 0.55);
  });
}

export function VoiceWaveform({
  analyser,
  activity,
  className,
}: {
  analyser: AnalyserNode | null;
  /** Aktivitas bicara 0..1 — penggerak bar bila `analyser` null. */
  activity?: () => number;
  className?: string;
}) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const time = analyser ? new Uint8Array(analyser.fftSize) : null;
    const binHz = analyser ? analyser.context.sampleRate / analyser.fftSize : 1;
    const heights = Array.from({ length: BARS }, () => FLOOR);
    const paint = (targets: number[], smooth: boolean) => {
      targets.forEach((target, i) => {
        const prev = heights[i] ?? FLOOR;
        const next = smooth ? prev + (target - prev) * (target > prev ? ATTACK : RELEASE) : target;
        heights[i] = next;
        const el = barsRef.current[i];
        if (el) el.style.transform = `scaleY(${Math.min(1, Math.max(FLOOR, next))})`;
      });
    };
    // Reduced motion tanpa data mic: gelombang diam (tidak ada info baru).
    if (!analyser && reduce) {
      paint(waveformHeights(syntheticShape(BARS, 0), 0.35, FLOOR), false);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      if (analyser && freq && time) {
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(time);
        paint(waveformHeights(barLevels(freq, BARS, binHz), volumeLevel(time), FLOOR), true);
      } else {
        const level = Math.max(IDLE, activity?.() ?? 0.35);
        paint(waveformHeights(syntheticShape(BARS, (now - started) / 1000), level, FLOOR), true);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser, activity]);

  return (
    <div aria-hidden className={cn("flex h-5 items-center gap-[2px]", className)}>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: jumlah bar tetap, urutan = posisi
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="h-full w-[3px] origin-center rounded-full bg-primary"
          style={{ transform: `scaleY(${FLOOR})` }}
        />
      ))}
    </div>
  );
}

export function MicButton({
  support,
  disabled,
  onClick,
  className,
}: {
  support: SpeechSupport;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  if (support === "unsupported") return null;
  const insecure = support === "insecure";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled || insecure}
      aria-label="Voice input"
      title={
        insecure
          ? "Voice input needs a secure connection (HTTPS or localhost)"
          : "Speak your message — it sends when you stop talking"
      }
      className={cn("size-9 shrink-0 text-muted-foreground hover:text-foreground", className)}
    >
      <MicIcon />
    </Button>
  );
}

export function VoiceDictationPill({
  analyser,
  activity,
  onCancel,
  onFinish,
  className,
}: {
  analyser: AnalyserNode | null;
  activity?: () => number;
  onCancel: () => void;
  onFinish: () => void;
  className?: string;
}) {
  // Esc di mana pun selama mendengarkan = batal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: grup kontrol dikte, bukan fieldset form.
    <div
      role="group"
      aria-label="Voice input"
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-0.5 animate-in fade-in zoom-in-95 duration-200",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onCancel}
        aria-label="Cancel voice input"
        title="Cancel (Esc)"
        className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
      >
        <XIcon />
      </Button>
      <VoiceWaveform analyser={analyser} activity={activity} />
      <Button
        type="button"
        size="icon"
        onClick={onFinish}
        aria-label="Send now"
        title="Send now"
        className="size-8 shrink-0 rounded-full"
      >
        <CheckIcon />
      </Button>
      <span role="status" className="sr-only">
        Listening…
      </span>
    </div>
  );
}
