/**
 * Panel kartu Interactive_Prompt yang mengambang DI ATAS composer (ala dialog
 * izin Claude/opencode) — selalu terlihat tanpa scroll, bahkan di percakapan
 * panjang. Permission identik (kind+title sama) digroup jadi SATU kartu agar
 * request berulang opencode tidak membanjiri UI.
 *
 * Dua mode tata letak:
 * - Mode gantung (default): panel mengambang di atas composer (`max-h-72`
 *   desktop, 60% layar di HP),
 *   seluruh panel ikut scroll bila isinya panjang. Dipakai permission kartu
 *   dan tampilan tanpa timeline (empty-state).
 * - Mode docked (`docked`): panel menempel ke dasar MENGGANTIKAN composer
 *   (dipakai saat question pending). Tinggi mengikuti sisa layar (`flex-1`),
 *   dan scroll dipindah ke DALAM kartu — hanya daftar jawaban yang scroll,
 *   header pertanyaan + footer aksi tetap terlihat.
 *
 * Animasi (Motion `AnimatePresence`): kartu masuk naik dari bawah + fade +
 * sedikit membesar; saat dijawab (`prompt_resolved` menghapusnya dari state)
 * kartu tetap di DOM sampai animasi keluarnya (turun + fade) selesai — tanpa
 * `setTimeout` atau state "resolving" manual. Panel pembungkus selalu
 * ter-mount (tanpa ruang saat kosong) agar kartu terakhir sempat beranimasi.
 */
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { PromptCard } from "@/components/sessions/PromptCard";
import { CONVERSATION_MAX_W } from "@/lib/layout";
import { cn } from "@/lib/utils";
import type { InteractivePrompt, PromptResponse } from "@/types";

export interface PromptPanelProps {
  /** Grup prompt pending (identik) yang tampil sebagai satu kartu. */
  groups: InteractivePrompt[][];
  /** Error resolusi terakhir — ditampilkan di kartu yang relevan. */
  errorSignal: string | null;
  onResolve: (promptId: string, response: PromptResponse) => void;
  onConsumeError: () => void;
  /**
   * `true` = panel docked di dasar menggantikan composer: tanpa batas
   * tinggi sendiri (mewarisi sisa kolom) dan kartu menangani scroll
   * internalnya sendiri (hanya area jawaban).
   */
  docked?: boolean;
}

/** Kurva "mendarat halus" yang sama dengan animasi lain di app. */
const EASE_OUT: [number, number, number, number] = [0.32, 0.72, 0, 1];

export function PromptPanel({
  groups,
  errorSignal,
  onResolve,
  onConsumeError,
  docked = false,
}: PromptPanelProps) {
  // Panel selalu ter-mount (kosong = tanpa padding/ruang) agar kartu
  // terakhir tetap bisa memainkan animasi keluar sebelum hilang.
  const empty = groups.length === 0;
  return (
    <div
      aria-live="polite"
      className={
        empty
          ? "pointer-events-none relative z-30"
          : docked
            ? // Docked: tinggi ALAMI kartu (bukan flex-1 — kartu pendek tidak
              // lagi memakan separuh layar), dibatasi 75% layar; bila isinya
              // lebih panjang, panel menyusut dan hanya daftar jawaban yang
              // scroll. Composer tidak ada, jadi panel yang menjaga safe-area
              // bawah (home indicator iOS).
              "pointer-events-auto relative z-30 flex max-h-[75dvh] min-h-0 shrink flex-col gap-2 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:max-h-[min(75dvh,36rem)] sm:px-4 sm:pb-3"
            : // HP: kartu izin memakai tombol setinggi target sentuh yang
              // bertumpuk, jadi butuh ruang lebih (60% layar) agar semua aksi
              // terlihat tanpa scroll. Desktop tetap ringkas (max-h-72).
              "pointer-events-auto relative z-30 mb-1.5 flex max-h-[60dvh] flex-col gap-2 overflow-y-auto overscroll-contain px-3 pt-2 sm:max-h-72 sm:px-4"
      }
    >
      <AnimatePresence initial mode="popLayout">
        {groups.map((group) => (
          <m.div
            key={group[0]?.id}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { duration: 0.4, ease: EASE_OUT },
            }}
            exit={{
              opacity: 0,
              y: 16,
              scale: 0.96,
              transition: { duration: 0.2, ease: "easeIn" },
            }}
            className={
              docked
                ? cn("mx-auto flex min-h-0 w-full flex-col", CONVERSATION_MAX_W)
                : cn("pointer-events-auto mx-auto w-full", CONVERSATION_MAX_W)
            }
          >
            <PromptCard
              prompts={group}
              onResolve={onResolve}
              errorSignal={errorSignal}
              onConsumeError={onConsumeError}
              docked={docked}
            />
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
