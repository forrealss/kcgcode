/**
 * Sheet aksi mobile di composer (attach image + ganti agent mode).
 *
 * Tampilan ala Gemini: tanpa header teks (judul disembunyikan untuk a11y
 * saja) — langsung baris kartu aksi cepat + daftar mode agent.
 */
import { ImagePlusIcon } from "lucide-react";
import { AgentModeList } from "@/components/sessions/AgentModeList";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { UseAgentPickerResult } from "@/hooks/useAgentPicker";

export interface ComposerActionSheetProps {
  /** Input tidak boleh dipakai (Session mati / sibuk) — aksi ikut terkunci. */
  disabled: boolean;
  /** Buka file picker gambar (sheet ditutup oleh pemanggil). */
  onPickImage: () => void;
  agentPicker: UseAgentPickerResult;
  activeAgent: string | null;
  onPickAgent: (name: string | null) => void;
}

export function ComposerActionSheet({
  disabled,
  onPickImage,
  agentPicker,
  activeAgent,
  onPickAgent,
}: ComposerActionSheetProps) {
  return (
    <SheetContent side="bottom" className="gap-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Judul disembunyikan secara visual (a11y saja) — tampilan ala Gemini:
          langsung kartu aksi + daftar mode, tanpa header teks. */}
      <SheetHeader className="sr-only">
        <SheetTitle>Composer actions</SheetTitle>
        <SheetDescription>
          Attach an image or switch the agent mode for this Session.
        </SheetDescription>
      </SheetHeader>

      {/* Baris kartu aksi cepat (ikon di atas, label di bawah) — saat ini baru
          "Image", tapi baris scroll-x ini siap menampung aksi lain (mis.
          attach file) nanti. */}
      <div className="flex gap-3 overflow-x-auto px-4">
        <button
          type="button"
          disabled={disabled}
          onClick={onPickImage}
          className="flex shrink-0 flex-col items-center gap-1.5 rounded-2xl bg-muted px-5 py-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <ImagePlusIcon className="size-5" />
          Image
        </button>
      </div>

      {/* Daftar mode agent — diberi label + keterangan singkat supaya jelas
          ini adalah SWITCH mode, bukan cuma nama agent aktif yang
          membingungkan (mis. "Default" polos). */}
      <div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
          Agent mode — choose how the agent handles your next message
        </p>
        <AgentModeList
          agents={agentPicker.agents}
          loading={agentPicker.loading}
          error={agentPicker.error}
          activeAgent={activeAgent}
          saving={agentPicker.saving}
          disabled={disabled}
          onPick={onPickAgent}
        />
      </div>
    </SheetContent>
  );
}
