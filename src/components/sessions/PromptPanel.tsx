/**
 * Panel kartu Interactive_Prompt yang mengambang DI ATAS composer (ala dialog
 * izin Claude/opencode) — selalu terlihat tanpa scroll, bahkan di percakapan
 * panjang. Permission identik (kind+title sama) digroup jadi SATU kartu agar
 * request berulang opencode tidak membanjiri UI.
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
}

export function PromptPanel({
  groups,
  resolving,
  errorSignal,
  onResolve,
  onConsumeError,
}: PromptPanelProps) {
  if (groups.length === 0) return null;
  return (
    <div className="pointer-events-auto relative z-30 mb-1.5 flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pt-2 sm:px-4">
      {groups.map((group) => (
        <div key={group[0]?.id} className="pointer-events-auto mx-auto w-full max-w-3xl">
          <PromptCard
            prompts={group}
            onResolve={onResolve}
            errorSignal={errorSignal}
            onConsumeError={onConsumeError}
            exiting={group.every((p) => resolving.has(p.id))}
          />
        </div>
      ))}
    </div>
  );
}
