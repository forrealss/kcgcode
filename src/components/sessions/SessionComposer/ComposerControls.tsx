/**
 * Kontrol di sekitar textarea composer: tombol kirim/Stop, slot "Mode"
 * (permission mode atau agent), dan susunan barisnya per varian.
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
import { AgentPicker } from "@/components/sessions/AgentPicker";
import { PermissionModePicker } from "@/components/sessions/PermissionModePicker";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { UsePermissionModesResult } from "@/hooks/usePermissionModes";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";

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

export interface ComposerModeSlotProps {
  session: Session;
  /** Agent (mode) pilihan Session; null = default. */
  agent: string | null;
  onAgentChange: (agent: string | null) => void;
  permissionPicker: UsePermissionModesResult;
  /** Agent memiliki permission mode (capability sudah termuat & tidak kosong). */
  hasPermissionModes: boolean;
  /** Permission mode aktif. */
  permissionMode: string | null;
  disabled: boolean;
}

/**
 * Slot "Mode" desktop: permission mode (agent yang memilikinya) atau agent;
 * kosong selama capability belum termuat (hindari kedip).
 */
export function ComposerModeSlot({
  session,
  agent,
  onAgentChange,
  permissionPicker,
  hasPermissionModes,
  permissionMode,
  disabled,
}: ComposerModeSlotProps) {
  if (hasPermissionModes) {
    return (
      <PermissionModePicker picker={permissionPicker} active={permissionMode} disabled={disabled} />
    );
  }
  if (permissionPicker.modes === null) return null;
  return (
    <AgentPicker
      projectId={session.projectId}
      agentType={session.agentType}
      sessionId={session.id}
      agent={agent}
      onChanged={onAgentChange}
      disabled={disabled}
    />
  );
}

export interface DesktopComposerRowProps {
  stacked: boolean;
  disabled: boolean;
  /** `ComposerTextarea` ber-key `composer-textarea`. */
  textarea: ReactNode;
  /** Slot "Mode" (`ComposerModeSlot`). */
  mode: ReactNode;
  /** `SendOrStopButton`. */
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
  /** `SendOrStopButton`. */
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
