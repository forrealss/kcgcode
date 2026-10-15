/**
 * Status kirim jawaban kartu Interactive_Prompt — dipakai bersama kartu izin
 * (`PermissionCard`) dan kartu pertanyaan (`QuestionCard`).
 *
 * - `submit(key, response)` meneruskan respon ke SEMUA id anggota grup
 *   (server fan-out). Tombol `key` menampilkan spinner dan seluruh aksi
 *   terkunci sampai `prompt_resolved` menghapus kartu.
 * - Kegagalan kirim (WS putus) maupun error server (`errorSignal`, kode
 *   PROMPT_*) tampil DI kartu dan membuka kunci aksi lagi — klik yang gagal
 *   tidak diam saja sehingga tombol terasa mati.
 */
import { useEffect, useRef, useState } from "react";
import type { InteractivePrompt, PromptResponse } from "@/types";

export interface PromptSubmission {
  /** Key aksi yang diklik — spinner pada tombol itu, tombol lain terkunci. */
  submittingKey: string | null;
  /** Pesan error klik TERAKHIR — tampil di kartu, bukan di atas chat. */
  error: string | null;
  /** Kirim respon ke seluruh anggota grup (diabaikan selama masih mengirim). */
  submit: (key: string, response: PromptResponse) => void;
}

export function usePromptSubmission({
  prompts,
  onResolve,
  errorSignal,
  onConsumeError,
}: {
  prompts: InteractivePrompt[];
  onResolve: (promptId: string, response: PromptResponse) => void;
  errorSignal?: string | null;
  onConsumeError?: () => void;
}): PromptSubmission {
  const promptId = prompts[0]?.id;
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  /** Kunci kirim sinkron — mencegah balasan ganda dari klik beruntun cepat. */
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Error server (PROMPT_NOT_FOUND / PROMPT_ALREADY_RESOLVED) -> tampil di
  // kartu, lalu sinyal dikonsumsi supaya tidak muncul di kartu lain.
  useEffect(() => {
    if (errorSignal) {
      sendingRef.current = false;
      setSubmittingKey(null);
      setError(errorSignal);
      onConsumeError?.();
    }
  }, [errorSignal, onConsumeError]);

  // Kartu dipakai ulang untuk grup prompt berbeda (id berganti) — reset
  // status kirim agar tidak membawa kunci/error kartu sebelumnya.
  // biome-ignore lint/correctness/useExhaustiveDependencies: promptId sengaja jadi satu-satunya trigger reset state
  useEffect(() => {
    sendingRef.current = false;
    setSubmittingKey(null);
    setError(null);
  }, [promptId]);

  const submit = (key: string, response: PromptResponse) => {
    // Kunci SINKRON (ref), bukan state: klik beruntun cepat terjadi sebelum
    // React me-render ulang, sehingga `submittingKey` dari closure masih
    // null dan tiap klik lolos -> balasan ganda ke opencode.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    setSubmittingKey(key);
    try {
      for (const p of prompts) onResolve(p.id, response);
    } catch (e) {
      // Gagal kirim (WS putus dsb.) — pesan error di kartu, tombol aktif lagi.
      sendingRef.current = false;
      setSubmittingKey(null);
      setError(e instanceof Error ? e.message : "Failed to send the response.");
    }
  };

  return { submittingKey, error, submit };
}
