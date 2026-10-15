/**
 * Kontrol di sekitar textarea composer: tombol kirim/Stop dan susunan
 * barisnya per varian (slot "Mode" = `AgentModeSlot`).
 *
 * - Desktop (`DesktopComposerRow`): attach | textarea | Mode | kirim/stop.
 * - Mobile (`MobileComposerRow`): satu tombol aksi (`Sheet`) | textarea |
 *   kirim/stop.
 *
 * Tiap varian punya susunan inline (satu baris) dan stacked (kontrol turun
 * ke baris di bawah textarea, ala Gemini). Textarea dioper sebagai elemen
 * ber-`key` `composer-textarea`, sehingga React memakai ulang elemennya
 * (beserta fokus) saat susunan inline <-> stacked berganti.
 */
import { PaperclipIcon, PlusIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

export interface SendOrStopButtonProps {
  /** Model merespon DAN Session berjalan — tampil tombol Stop. */
  generating: boolean;
  /** Ada prompt atau lampiran — syarat tombol kirim muncul. */
  hasContent: boolean;
  /** Kirim diizinkan (input aktif + ada isi). */
  canSubmit: boolean;
  /** Upload lampiran sedang berjalan (spinner di tombol kirim). */
  sending: boolean;
  wsStatus: WsConnectionStatus;
  /** Hentikan balasan model (interrupt) — Session tetap aktif. */
  onInterrupt: () => void;
}

/** Tombol kirim (submit form) atau Stop saat model merespon. */
export function SendOrStopButton({
  generating,
  hasContent,
  canSubmit,
  sending,
  wsStatus,
  onInterrupt,
}: SendOrStopButtonProps) {
  if (generating) {
    // Saat model merespon: tombol kirim berubah jadi tombol Stop
    // (hentikan balasan saja, Session tetap aktif ala opencode).
    return (
      <Button
        key="composer-stop"
        type="button"
        variant="outline"
        size="icon"
        onClick={onInterrupt}
        disabled={wsStatus !== "connected"}
        aria-label="Stop response"
        title="Stop the model response"
        className="size-9 shrink-0 border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <SquareIcon className="size-3.5" />
      </Button>
    );
  }
  // Tombol kirim muncul setelah ada prompt atau lampiran gambar.
  if (!hasContent) return null;
  return (
    <Button
      key="composer-send"
      type="submit"
      size="icon"
      disabled={!canSubmit}
      aria-label="Send message"
      className="size-9 shrink-0"
    >
      {sending ? <Spinner className="size-4" /> : <SendHorizontalIcon />}
    </Button>
  );
}

export interface DesktopComposerRowProps {
  stacked: boolean;
  disabled: boolean;
  /** `ComposerTextarea` ber-key `composer-textarea`. */
  textarea: ReactNode;
  /** Slot "Mode" (`AgentModeSlot`). */
  mode: ReactNode;
  /** Slot kirim/stop: mic + `SendOrStopButton`, atau pil dikte suara. */
  sendOrStop: ReactNode;
  /** Buka file picker lampiran. */
  onAttach: () => void;
}

/**
 * Desktop: attach image, agent mode, dan kirim/stop tetap tampil langsung
 * sebagai kontrol terpisah di toolbar composer. Satu baris: semuanya
 * sejajar; multiline: kontrol turun ke bawah textarea (ala Gemini).
 */
export function DesktopComposerRow({
  stacked,
  disabled,
  textarea,
  mode,
  sendOrStop,
  onAttach,
}: DesktopComposerRowProps) {
  const attachImageEl = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onAttach}
      disabled={disabled}
      aria-label="Attach files"
      title="Attach files (or drop them here, max 20 MiB each)"
      className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
    >
      <PaperclipIcon data-icon="inline-start" />
    </Button>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-1">
        {textarea}
        <div className="flex items-center justify-between gap-1">
          {attachImageEl}
          <div className="flex items-center gap-1">
            {mode}
            {sendOrStop}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {attachImageEl}
      {textarea}
      {mode}
      {sendOrStop}
    </div>
  );
}

export interface MobileComposerRowProps {
  stacked: boolean;
  disabled: boolean;
  /** `ComposerTextarea` ber-key `composer-textarea`. */
  textarea: ReactNode;
  /** Slot kirim/stop: mic + `SendOrStopButton`, atau pil dikte suara. */
  sendOrStop: ReactNode;
  /** Sheet aksi terbuka (state milik composer). */
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  /** Isi Sheet aksi (`ComposerActionSheet`). */
  children: ReactNode;
}

/**
 * Mobile: satu tombol aksi (attach image + agent mode) lewat Sheet, supaya
 * baris composer HP tetap ringkas (3 elemen saja).
 */
export function MobileComposerRow({
  stacked,
  disabled,
  textarea,
  sendOrStop,
  sheetOpen,
  onSheetOpenChange,
  children,
}: MobileComposerRowProps) {
  const actionTrigger = (
    <SheetTrigger asChild key="composer-actions-trigger">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label="More actions"
        title="Attach files or change agent mode"
        className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <PlusIcon data-icon="inline-start" />
      </Button>
    </SheetTrigger>
  );

  return (
    <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
      <div className={cn("flex gap-1", stacked ? "flex-col" : "items-center")}>
        {stacked ? (
          <>
            {textarea}
            <div className="flex items-center justify-between gap-1">
              {actionTrigger}
              {sendOrStop}
            </div>
          </>
        ) : (
          <>
            {actionTrigger}
            {textarea}
            {sendOrStop}
          </>
        )}
      </div>
      {children}
    </Sheet>
  );
}
