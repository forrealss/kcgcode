/**
 * Dikte suara untuk composer: tekan mic -> ucapan tampil live di input ->
 * diam sejenak -> `onFinish` (composer langsung mengirim, tanpa Enter).
 *
 * - `SpeechRecognition` kontinu (Android: satu ucapan) + hasil sementara.
 *   Timer hening dimulai ulang
 *   tiap ada hasil baru; habis -> `stop()` (hasil final terakhir masih
 *   dikirim browser) -> `onend` -> `onFinish(teks)`.
 * - Tidak ada ucapan sama sekali dalam `NO_SPEECH_MS` -> berhenti tanpa kirim.
 *   Batas satu dikte `MAX_MS`.
 * - `finish()` = selesai & kirim sekarang; `cancel()` = batal, teks input
 *   dikembalikan ke sebelum dikte. Browser berhenti sendiri (mis. Safari)
 *   diperlakukan seperti selesai.
 * - Error (izin ditolak, tanpa mic, offline) -> `onError(pesan)`; teks yang
 *   sudah terdengar dibiarkan di input, tidak dikirim.
 * - Visual: `getUserMedia` + `AnalyserNode` paralel untuk bar frekuensi
 *   (`analyser`) — bar mengikuti suara mic sungguhan. `AudioContext` dibuat
 *   & dilanjutkan SELAGI masih di dalam klik: yang dibuat setelah prompt izin
 *   bisa tertahan "suspended" (kebijakan autoplay) sehingga bar diam.
 * - Gagal / iOS (dua pengguna mic sekaligus bisa mengganggu pengenalan) ->
 *   `analyser` null; bar digerakkan `voiceActivity()`: lonjakan tiap ada kata
 *   baru dari pengenal suara yang meluruh cepat — tetap bereaksi saat bicara.
 *
 * Callback dibaca dari ref -> selalu versi render terbaru (state composer
 * terkini saat mengirim).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isIOS } from "@/lib/pwa";
import {
  mergeDictation,
  recognitionCtor,
  resolveSpeechLang,
  type SpeechRecognitionLike,
  type SpeechSupport,
  speechErrorMessage,
  speechLangPref,
  speechSupport,
} from "@/lib/speech";

/** Jeda hening setelah ucapan terakhir sebelum dianggap selesai bicara. */
const SILENCE_MS = 2000;
/** Tanpa ucapan sama sekali selama ini -> berhenti tanpa kirim. */
const NO_SPEECH_MS = 8000;
/** Batas satu dikte. */
const MAX_MS = 60_000;
/** Peluruhan aktivitas bicara (cadangan visual tanpa analyser). */
const ACTIVITY_DECAY_MS = 450;

export interface SpeechToTextOptions {
  /** Teks input live: teks awal + transkrip, tiap ada hasil baru. */
  onText: (text: string) => void;
  /** Selesai bicara — teks final gabungan, siap dikirim. */
  onFinish: (text: string) => void;
  onError: (message: string) => void;
}

type Ending = "finish" | "cancel" | "keep" | "unmount";

interface Dictation {
  rec: SpeechRecognitionLike;
  base: string;
  finals: string;
  interim: string;
  ending: Ending | null;
  timers: ReturnType<typeof setTimeout>[];
  silence: ReturnType<typeof setTimeout> | undefined;
  stream: MediaStream | null;
  audio: AudioContext | null;
  /** Panjang transkrip terakhir & lonjakan aktivitas bicara terakhir. */
  spokenLength: number;
  activity: { value: number; at: number };
}

export interface SpeechToText {
  support: SpeechSupport;
  listening: boolean;
  /** Sumber bar frekuensi; null = belum siap / tidak tersedia. */
  analyser: AnalyserNode | null;
  /** Aktivitas bicara 0..1 dari pengenal suara (cadangan tanpa analyser). */
  voiceActivity: () => number;
  /** Mulai dikte; `base` = teks yang sudah ada di input. */
  start: (base: string) => void;
  /** Selesai sekarang & kirim. */
  finish: () => void;
  /** Batal: kembalikan teks input ke sebelum dikte. */
  cancel: () => void;
}

export function useSpeechToText(options: SpeechToTextOptions): SpeechToText {
  const [support] = useState(speechSupport);
  const [listening, setListening] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const current = useRef<Dictation | null>(null);

  const release = useCallback((d: Dictation) => {
    for (const t of d.timers) clearTimeout(t);
    clearTimeout(d.silence);
    for (const track of d.stream?.getTracks() ?? []) track.stop();
    void d.audio?.close().catch(() => {});
  }, []);

  /** `onend`: satu-satunya tempat dikte benar-benar ditutup. */
  const finalize = useCallback(
    (d: Dictation) => {
      if (current.current !== d) return;
      current.current = null;
      release(d);
      setListening(false);
      setAnalyser(null);
      const { onText, onFinish } = optionsRef.current;
      const text = mergeDictation(d.base, d.finals, d.interim);
      const spoke = text.trim() !== d.base.trim();
      switch (d.ending) {
        case "cancel":
          onText(d.base);
          break;
        case "keep":
        case "unmount":
          break;
        case "finish":
          // Hening / tombol ✓ — kirim apa pun yang ada di input.
          if (text.trim() !== "") onFinish(text);
          break;
        default:
          // Browser berhenti sendiri (Safari, mode satu ucapan Android).
          if (spoke) onFinish(text);
          else onText(d.base);
      }
    },
    [release],
  );

  const end = useCallback((d: Dictation, ending: Ending) => {
    if (current.current !== d || d.ending !== null) return;
    d.ending = ending;
    for (const t of d.timers) clearTimeout(t);
    clearTimeout(d.silence);
    try {
      // Selesai: `stop()` masih mengirim hasil final terakhir sebelum `onend`.
      if (ending === "finish") d.rec.stop();
      else d.rec.abort();
    } catch {
      // Sudah berhenti — `onend` tetap / sudah dipanggil.
    }
  }, []);

  const openAnalyser = useCallback(async (d: Dictation) => {
    if (isIOS(navigator.userAgent, navigator.maxTouchPoints)) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") return;
    // Masih di dalam klik (dipanggil sinkron dari `start`) — lihat header.
    const audio = new AudioContext();
    d.audio = audio;
    void audio.resume().catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (current.current !== d) {
        // Dikte sudah selesai (AudioContext ikut ditutup `release`).
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      d.stream = stream;
      if (audio.state === "suspended") await audio.resume().catch(() => {});
      const node = audio.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.55;
      audio.createMediaStreamSource(stream).connect(node);
      setAnalyser(node);
    } catch {
      // Tanpa visual nyata — gelombang sintetis. Izin ditolak dilaporkan
      // oleh `SpeechRecognition` sendiri.
    }
  }, []);

  const start = useCallback(
    (base: string) => {
      if (current.current) return;
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      const rec = new Ctor();
      rec.lang = resolveSpeechLang(speechLangPref(), navigator.language);
      // Chrome Android mengulang potongan hasil di mode kontinu — di sana
      // pakai mode satu ucapan (berhenti sendiri begitu pengguna diam).
      rec.continuous = !/Android/i.test(navigator.userAgent);
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      const d: Dictation = {
        rec,
        base,
        finals: "",
        interim: "",
        ending: null,
        timers: [],
        silence: undefined,
        stream: null,
        audio: null,
        spokenLength: 0,
        activity: { value: 0, at: 0 },
      };

      rec.onresult = (event) => {
        if (current.current !== d || d.ending === "cancel") return;
        // Mode kontinu: `results` berisi SEMUA hasil sejak mulai.
        let finals = "";
        let interim = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript ?? "";
          if (result?.isFinal) finals += transcript;
          else interim += transcript;
        }
        d.finals = finals;
        d.interim = interim;
        // Kata baru terdengar -> lonjakan aktivitas (makin banyak makin tinggi).
        const spokenLength = finals.length + interim.length;
        if (spokenLength !== d.spokenLength) {
          const grew = Math.abs(spokenLength - d.spokenLength);
          d.activity = { value: Math.min(1, 0.55 + grew * 0.04), at: performance.now() };
          d.spokenLength = spokenLength;
        }
        if (d.ending !== null) return;
        optionsRef.current.onText(mergeDictation(d.base, finals, interim));
        clearTimeout(d.silence);
        d.silence = setTimeout(() => end(d, "finish"), SILENCE_MS);
      };
      rec.onerror = (event) => {
        const message = speechErrorMessage(event.error);
        if (message === null) return;
        if (d.ending === null) d.ending = "keep";
        optionsRef.current.onError(message);
      };
      rec.onend = () => finalize(d);

      current.current = d;
      try {
        rec.start();
      } catch {
        current.current = null;
        optionsRef.current.onError(speechErrorMessage("start") ?? "");
        return;
      }
      setListening(true);
      d.timers.push(
        setTimeout(() => {
          // Belum ada ucapan sama sekali -> berhenti tanpa kirim.
          if (d.finals === "" && d.interim === "") end(d, "cancel");
        }, NO_SPEECH_MS),
        setTimeout(() => end(d, "finish"), MAX_MS),
      );
      void openAnalyser(d);
    },
    [end, finalize, openAnalyser],
  );

  const voiceActivity = useCallback(() => {
    const a = current.current?.activity;
    if (!a || a.at === 0) return 0;
    return a.value * Math.exp(-(performance.now() - a.at) / ACTIVITY_DECAY_MS);
  }, []);

  const finish = useCallback(() => {
    if (current.current) end(current.current, "finish");
  }, [end]);
  const cancel = useCallback(() => {
    if (current.current) end(current.current, "cancel");
  }, [end]);

  // Composer ditutup di tengah dikte: hentikan tanpa callback apa pun.
  useEffect(
    () => () => {
      const d = current.current;
      if (!d) return;
      d.ending = "unmount";
      current.current = null;
      release(d);
      try {
        d.rec.abort();
      } catch {
        // abaikan
      }
    },
    [release],
  );

  return { support, listening, analyser, voiceActivity, start, finish, cancel };
}
