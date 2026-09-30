/**
 * Tampilan Session — versi headless (opencode serve).
 *
 * Berbeda dari versi PTY/TUI (yang me-render chunk byte terminal TUI):
 * - Pesan datang sebagai `SessionMessage` terstruktur (`role` + `parts`):
 *   text, reasoning (collapsible per part, urut sesuai alur), tool/step.
 * - Interactive_Prompt (permission/question) dirender via `PromptCard.tsx`.
 * - Saat model merespon (`turn_active` true / pesan streaming) tombol kirim
 *   berubah jadi tombol Stop (kirim `{ type: "interrupt" }`) — menghentikan
 *   balasan saja ala opencode, Session tetap berjalan. `{ type: "stop" }`
 *   (menonaktifkan Session) tetap ada lewat daftar Session / HTTP.
 *
 * File ini sekarang HANYA menyusun area layar dari bagian-bagian yang
 * sudah dipisah:
 * - State & alur WS: `hooks/useSessionChat.ts`.
 * - Logika transformasi pesan murni: `lib/turns.ts` (type di `types/turns.ts`).
 * - Area UI: `SessionHeader`, `SessionTimeline`, `PromptPanel`,
 *   `SessionComposer` di folder yang sama.
 * - Drag & drop file: `FileDropOverlay` (portal, menutupi seluruh viewport)
 *   meneruskan file ke composer (`SessionComposerHandle.addFiles`).
 */
import { useRef } from "react";
import { ConfirmSessionDeleteDialog } from "@/components/sessions/ConfirmSessionDeleteDialog";
import { FileDropOverlay } from "@/components/sessions/FileDropOverlay";
import { SessionComposer, type SessionComposerHandle } from "@/components/sessions/SessionComposer";
import { SessionHeader } from "@/components/sessions/SessionHeader";
import { SessionTimeline } from "@/components/sessions/SessionTimeline";
import { useSessionChat } from "@/hooks/useSessionChat";
import type { Session } from "@/types";
import { PromptPanel } from "./PromptPanel";

export interface SessionViewProps {
  session: Session;
  onBack: () => void;
  /**
   * Dipanggil setelah Session dihapus dari menu aksi header. Bila tidak
   * diberikan, `onBack` dipakai — halaman ini tidak punya data lagi untuk
   * ditampilkan setelah Session hilang.
   */
  onDeleted?: () => void;
}

export function SessionView({ session, onBack, onDeleted }: SessionViewProps) {
  const chat = useSessionChat({ session, onBack, onDeleted });
  const empty = chat.messages.length === 0;
  const composerRef = useRef<SessionComposerHandle>(null);
  // Composer tidak dirender saat pertanyaan menunggu jawaban (panel docked).
  const composerShown = empty || !chat.hasPendingQuestion;
  const acceptingFiles = composerShown && chat.canInput;
  const blockedReason = !composerShown
    ? "Answer the question first, then add your files."
    : chat.busy
      ? "Wait for the response to finish, then drop your files."
      : "Start the session to add files.";

  return (
    // `data-vt-name`: tujuan transisi "to-session" — composer homepage meluas
    // menjadi seluruh area ini (lihat styles/globals.css).
    <div data-vt-name="session-surface" className="flex h-full min-h-0 flex-col">
      <SessionHeader
        session={session}
        status={chat.status}
        wsStatus={chat.wsStatus}
        onStop={() => void chat.stop()}
        onStart={() => void chat.start()}
        onRequestDelete={chat.beginDelete}
        stopping={chat.stopping}
        starting={chat.starting}
      />

      {empty ? (
        /* Empty-state ala Gemini: sapaan + composer dipusatkan vertikal.
            Timeline & prompt panel belum dirender (tidak ada isinya); spacer
            flex-1 di atas & bawah menjaga blok ini tepat di tengah kolom di
            bawah header. Begitu pesan pertama masuk (echo WS), layout pindah
            ke varian percakapan di bawah — composer turun ke dasar. */
        <div className="flex min-h-0 flex-1 flex-col px-3 sm:px-4">
          <div className="min-h-0 flex-[2]" />
          <div className="mx-auto w-full max-w-3xl">
            <h1 className="mb-6 text-center text-2xl font-medium tracking-tight sm:text-3xl">
              No conversation yet
            </h1>
            <SessionComposer
              ref={composerRef}
              session={session}
              inputAllowed={chat.canInput}
              busy={chat.busy}
              generating={chat.generating}
              wsStatus={chat.wsStatus}
              send={chat.send}
              reportError={chat.reportError}
              onInterrupt={chat.interrupt}
            />
          </div>
          <div className="min-h-0 flex-[3]" />
        </div>
      ) : (
        <>
          <SessionTimeline
            error={chat.error}
            status={chat.status}
            messages={chat.messages}
            collapsible={chat.collapsible}
            onToggle={chat.toggleBlock}
            generating={chat.generating}
          />

          {/* Question pending: panel DOCKED menggantikan composer — jawaban
              pertanyaan adalah satu-satunya input saat ini (ala TUI opencode).
              Hanya area jawaban kartu yang scroll; footer aksi tetap terlihat.
              Permission (bukan question): panel tetap mengambang DI ATAS
              composer seperti biasa. */}
          <PromptPanel
            groups={chat.promptGroups}
            errorSignal={chat.promptError}
            onResolve={chat.resolvePrompt}
            onConsumeError={chat.consumePromptError}
            docked={chat.hasPendingQuestion}
          />

          {!chat.hasPendingQuestion && (
            <SessionComposer
              ref={composerRef}
              session={session}
              inputAllowed={chat.canInput}
              busy={chat.busy}
              generating={chat.generating}
              wsStatus={chat.wsStatus}
              send={chat.send}
              reportError={chat.reportError}
              onInterrupt={chat.interrupt}
            />
          )}
        </>
      )}

      <FileDropOverlay
        accepting={acceptingFiles}
        blockedReason={blockedReason}
        onDropFiles={(files, from) => composerRef.current?.addFiles(files, from)}
      />

      {/* Konfirmasi hapus Session dari menu aksi header */}
      <ConfirmSessionDeleteDialog
        open={chat.deleteOpen}
        onOpenChange={(open) => (open ? chat.beginDelete() : chat.cancelDelete())}
        deleting={chat.deleting}
        onConfirm={() => void chat.confirmDelete()}
      />
    </div>
  );
}
