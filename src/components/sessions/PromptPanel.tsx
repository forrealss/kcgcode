/**
 * Panel kartu Interactive_Prompt yang mengambang DI ATAS composer (ala dialog
 * izin Claude/opencode) — selalu terlihat tanpa scroll, bahkan di percakapan
 * panjang. Permission identik (kind+title sama) digroup jadi SATU kartu agar
 * request berulang opencode tidak membanjiri UI.
 *
 * Dua mode tata letak:
 * - Mode gantung (default): panel mengambang di atas composer, `max-h-72`,
 *   seluruh panel ikut scroll bila isinya panjang. Dipakai permission kartu
 *   dan tampilan tanpa timeline (empty-state).
 * - Mode docked (`docked`): panel menempel ke dasar MENGGANTIKAN composer
 *   (dipakai saat question pending). Tinggi mengikuti sisa layar (`flex-1`),
 *   dan scroll dipindah ke DALAM kartu — hanya daftar jawaban yang scroll,
 *   header pertanyaan + footer aksi tetap terlihat.
 */
import { PromptCard } from "@/components/sessions/PromptCard";
import type { InteractivePrompt, PromptResponse } from "@/types";

export interface PromptPanelProps {
  /** Grup prompt pending (identik) yang tampil sebagai satu kartu. */
  groups: InteractivePrompt[][];
  /** Prompt yang sedang memainkan animasi keluar sebelum dihapus. */
  resolving: Set<string>;
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

export function PromptPanel({
  groups,
  resolving,
  errorSignal,
  onResolve,
  onConsumeError,
  docked = false,
}: PromptPanelProps) {
  if (groups.length === 0) return null;
  return (
    <div
      className={
        docked
          ? // Docked: isi sisa kolom di bawah timeline — scroll ditangani kartu.
            "pointer-events-auto relative z-30 flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2 pt-2 sm:px-4"
          : "pointer-events-auto relative z-30 mb-1.5 flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pt-2 sm:px-4"
      }
    >
      {groups.map((group) => (
        <div
          key={group[0]?.id}
          className={
            docked ? "flex min-h-0 flex-1 flex-col" : "pointer-events-auto mx-auto w-full max-w-3xl"
          }
        >
          <PromptCard
            prompts={group}
            onResolve={onResolve}
            errorSignal={errorSignal}
            onConsumeError={onConsumeError}
            exiting={group.every((p) => resolving.has(p.id))}
            docked={docked}
          />
        </div>
      ))}
    </div>
  );
}
