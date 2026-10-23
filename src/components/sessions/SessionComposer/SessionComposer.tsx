/**
 * Composer input Session — textarea prompt, lampiran file (gambar maupun
 * file lain; lewat tombol, paste, atau drag & drop), autocomplete slash
 * command (`/` di awal pesan) & @file, mode agent, serta tombol kirim/stop.
 *
 * Drag & drop: overlay "Add anything" dipasang `SessionView` (menutupi
 * seluruh layar Session) dan memanggil `addFiles(files, fromRect)` lewat
 * ref. Dengan `fromRect`, file baru dianimasikan dari kartu overlay ke
 * deretan lampiran (`DropPlate`).
 *
 * Seluruh state input (teks, gambar pending, mention, agent mode) hidup di
 * komponen ini; engine (`useSessionChat`) hanya menyuplai izin input & kanal
 * kirim. Saat model merespon tombol kirim berubah jadi tombol Stop
 * (mengirim `{ type: "interrupt" }`) — menghentikan balasan saja,
 * Session tetap berjalan.
 *
 * Dikte suara (`useSpeechToText`): tombol mic di sebelah kirim; ucapan tampil
 * live di textarea, bar frekuensi di pil pengganti mic, dan pesan langsung
 * terkirim begitu pengguna diam (tanpa Enter).
 *
 * UI punya dua varian:
 * - Desktop: attach image | textarea | AgentPicker | kirim/stop.
 * - Mobile: satu tombol aksi (attach image + agent mode) lewat `Sheet`;
 *   saat input lebih dari satu baris, textarea pindah ke baris sendiri.
 *
 * Draf (teks, lampiran, elemen Preview terpilih) tersinkron dengan perangkat
 * lain & overlay Preview lewat `useDraftSync`: mengetik / melampirkan di
 * salah satu sisi langsung muncul di sisi lain; mengirim mengosongkan
 * keduanya.
 *
 * Bagian-bagiannya: `useComposerAttachments` (antrean lampiran + upload +
 * animasi plate), `useDraftSync`, `useStackedLayout` (inline vs stacked +
 * tinggi textarea),
 * `ComposerTextarea` (textarea + sorot mention), `ComposerControls`
 * (kirim/stop, slot Mode, susunan baris mobile & desktop).
 */
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AgentModeSlot } from "@/components/sessions/AgentModeSlot";
import { ComposerActionSheet } from "@/components/sessions/ComposerActionSheet";
import { ComposerSuggestions } from "@/components/sessions/ComposerSuggestions";
import { DraftElementChips } from "@/components/sessions/DraftElementChips";
import { DropPlate } from "@/components/sessions/DropPlate";
import { FileMentionDropdown } from "@/components/sessions/FileMentionDropdown";
import {
  type PendingAttachment,
  PendingAttachments,
} from "@/components/sessions/PendingAttachments";
import { SlashCommandDropdown } from "@/components/sessions/SlashCommandDropdown";
import { MicButton, VoiceDictationPill } from "@/components/sessions/VoiceInput";
import { useAgentPicker } from "@/hooks/useAgentPicker";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useFileMention } from "@/hooks/useMention";
import { usePermissionModes } from "@/hooks/usePermissionModes";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import { agentQuery } from "@/lib/agent-types";
import { apiErrorMessage, errorText } from "@/lib/api";
import { composerPlaceholder, extractMentionedFiles } from "@/lib/composer";
import { CONVERSATION_MAX_W } from "@/lib/layout";
import { cn } from "@/lib/utils";
import type { DraftElement, Session } from "@/types";
import type { ClientMessage } from "@/ws-protocol";
import { DesktopComposerRow, MobileComposerRow, SendOrStopButton } from "./ComposerControls";
import { ComposerTextarea } from "./ComposerTextarea";
import { useComposerAttachments } from "./useComposerAttachments";
import { useDraftSync } from "./useDraftSync";
import { useStackedLayout } from "./useStackedLayout";

/** Teks pesan bila hanya elemen Preview yang dilampirkan (sama dengan overlay). */
const ELEMENT_ONLY_TEXT = "Take a look at this element in the preview.";

/** Handle imperatif composer (dipakai overlay drag & drop). */
export interface SessionComposerHandle {
  /** Lampirkan file; `from` = rect asal animasi (kartu overlay). */
  addFiles: (files: File[], from?: DOMRect | null) => void;
}

export interface SessionComposerProps {
  ref?: Ref<SessionComposerHandle>;
  session: Session;
  /** Engine: input boleh dipakai (koneksi + Session running + tidak sibuk). */
  inputAllowed: boolean;
  /** Model sedang merespon (untuk placeholder & tombol Stop). */
  busy: boolean;
  /** Model merespon DAN Session berjalan — kirim berubah jadi Stop. */
  generating: boolean;
  wsStatus: WsConnectionStatus;
  /** Kirim pesan Client -> Server (engine); `false` = koneksi tidak siap. */
  send: (msg: ClientMessage) => boolean;
  /** Set error banner global (upload/kirim gagal). */
  reportError: (message: string | null) => void;
  /** Hentikan balasan model (interrupt) — Session tetap aktif. */
  onInterrupt: () => void;
  /** Permission mode aktif (agent dengan capability `permissionModes`). */
  permissionMode?: string | null;
  /** Permission mode diterima server — pemilik state memperbarui nilainya. */
  onPermissionModeChange?: (mode: string | null) => void;
}

export function SessionComposer({
  ref,
  session,
  inputAllowed,
  busy,
  generating,
  wsStatus,
  send,
  reportError,
  onInterrupt,
  permissionMode = null,
  onPermissionModeChange,
}: SessionComposerProps) {
  /** Layar sempit: placeholder composer dipendekkan agar tidak terpotong. */
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  /**
   * Lampiran pesan berikutnya. File lokal langsung di-upload (thumbnail
   * memakai object URL lokal); lampiran dari perangkat lain/overlay datang
   * lewat draf tersinkron.
   */
  const [pendingImages, setPendingImages] = useState<PendingAttachment[]>([]);
  /** Elemen halaman Preview yang dipilih dari overlay (draf tersinkron). */
  const [elements, setElements] = useState<DraftElement[]>([]);
  /**
   * Kotak composer — jangkar saran autocomplete (`ComposerSuggestions`) dan
   * tujuan akhir latar plate drop (`useComposerAttachments`).
   */
  const boxRef = useRef<HTMLDivElement | null>(null);
  /**
   * Textarea prompt — dipasang di `ComposerTextarea`, difokuskan ulang oleh
   * `applyPicked`, dan tingginya diatur `useStackedLayout`.
   */
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Upload lampiran sedang berjalan — cegah kirim ganda. */
  const [sending, setSending] = useState(false);
  /** Sheet aksi mobile (attach image + agent mode) di tombol tunggal kiri input. */
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  /** Agent (mode) pilihan Session — build/plan/agent kustom; null = default. */
  const [agent, setAgent] = useState<string | null>(session.agent);
  /**
   * Fetch + pick daftar agent untuk Sheet aksi mobile — dipakai langsung
   * (tanpa nested popover) supaya tap satu mode langsung menerapkannya.
   */
  const agentPicker = useAgentPicker(session.projectId, session.id, setAgent, session.agentType);
  /**
   * Permission mode (capability agent, mis. Claude Code). Agent yang
   * memilikinya memakai pemilih permission mode di slot "Mode" composer;
   * agent lain (opencode) memakai pemilih agent.
   */
  const permissionPicker = usePermissionModes(
    session.projectId,
    session.agentType,
    session.id,
    (mode) => onPermissionModeChange?.(mode),
  );
  const hasPermissionModes = (permissionPicker.modes?.length ?? 0) > 0;
  // Muat daftar agent begitu Sheet aksi mobile pertama dibuka (lazy, sama
  // seperti popover AgentPicker di desktop).
  useEffect(() => {
    if (actionSheetOpen && !hasPermissionModes) agentPicker.load();
  }, [actionSheetOpen, agentPicker.load, hasPermissionModes]);
  /**
   * Autocomplete `@file`: deteksi token @query di sekitar kursor + daftar
   * saran dari server (index file milik opencode, seperti `@` di TUI-nya).
   */
  /**
   * Terapkan teks hasil pemilihan saran (keyboard maupun mouse) ke state
   * input + kembalikan fokus ke textarea.
   */
  const applyPicked = useCallback((next: string) => {
    setText(next);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);
  const mention = useFileMention({
    endpoint: `/api/sessions/${session.id}/files`,
    onPick: applyPicked,
  });
  /**
   * Autocomplete slash command: `/` di awal pesan membuka daftar command
   * agent (bawaan, kustom, skill); pesan `/nama args` dijalankan agent.
   */
  const slash = useSlashCommands(
    `/api/projects/${session.projectId}/commands${agentQuery(session.agentType)}`,
    { onPick: applyPicked },
  );
  const mentionOpen =
    mention.mention !== null && (mention.suggestions.length > 0 || mention.loading);
  // Ala Gemini: begitu input tumbuh ke 2 baris (multiline), tombol aksi &
  // kirim/stop pindah ke baris di BAWAH textarea — berlaku di desktop
  // maupun mobile. Satu baris: semuanya dalam satu baris.
  const { multiline, formRef, measureRef } = useStackedLayout({
    text,
    attachmentCount: pendingImages.length,
    compact: isMobile,
    textareaRef,
  });

  /** Cache path yang pernah disarankan autocomplete (validitas @ref saat kirim). */
  const suggestedCacheRef = useRef<Set<string>>(new Set());
  if (mention.suggestions.length > 0) {
    for (const s of mention.suggestions) suggestedCacheRef.current.add(s);
  }

  // Dipanggil SETELAH `useStackedLayout`: pengukuran tujuan plate (layout
  // effect di hook ini) berjalan setelah tinggi textarea disesuaikan.
  const { plate, addFiles, removeAttachment, waitForUploads, registerAttachmentEl, endPlate } =
    useComposerAttachments({
      sessionId: session.id,
      pendingImages,
      setPendingImages,
      reportError,
      boxRef,
    });
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);
  useDraftSync({
    sessionId: session.id,
    send,
    text,
    setText,
    attachments: pendingImages,
    setAttachments: setPendingImages,
    elements,
    setElements,
  });

  /**
   * Input dapat dipakai = izin engine (koneksi + running + tidak busy) DAN
   * tidak sedang upload lampiran.
   */
  const canInput = inputAllowed && !sending;
  /** Ada prompt, lampiran, atau elemen terpilih — tombol kirim muncul. */
  const hasContent = text.trim() !== "" || pendingImages.length > 0 || elements.length > 0;
  const canSubmit = canInput && hasContent;

  /**
   * Kirim `message` (+ lampiran). Dipisah dari handler form agar dikte suara
   * bisa mengirim teks finalnya langsung — `text` di closure ini bisa jadi
   * belum memuat hasil dikte terakhir.
   */
  const submitMessage = async (message: string) => {
    if (!canInput || sending) return;
    if (message.trim() === "" && pendingImages.length === 0 && elements.length === 0) return;
    setSending(true);
    try {
      // Referensi @path dikenal dijadikan part `file` — teks asli tidak
      // diubah (tetap tampil di bubble); part `file` hanya penanda tambahan
      // agar isi file benar-benar dibaca opencode.
      const files = extractMentionedFiles(message, suggestedCacheRef.current);
      // Lampiran sudah di-upload saat ditambahkan; tunggu yang masih jalan.
      const uploaded = await waitForUploads();
      const images = pendingImages.flatMap((p) => {
        const id = p.id ?? uploaded.get(p.key);
        return id ? [id] : [];
      });
      // Konteks elemen Preview terpilih ditambahkan ke akhir pesan.
      const typed = message.trim() || (elements.length > 0 ? ELEMENT_ONLY_TEXT : "");
      const fullText = [typed, ...elements.map((e) => e.context)].filter(Boolean).join("\n\n");
      if (fullText === "" && images.length === 0) return;
      send({ type: "input", sessionId: session.id, text: fullText, files, images });
      for (const img of pendingImages) {
        if (img.file && img.previewUrl) URL.revokeObjectURL(img.previewUrl);
      }
      setPendingImages([]);
      setElements([]);
      setText("");
      mention.close();
      slash.close();
    } catch (e) {
      reportError(errorText(e, apiErrorMessage("ERROR")));
    } finally {
      setSending(false);
    }
  };

  const submitText = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitMessage(text);
  };

  /** Dikte suara: teks live ke textarea, diam -> langsung kirim. */
  const dictation = useSpeechToText({
    onText: setText,
    onFinish: (spoken) => {
      setText(spoken);
      void submitMessage(spoken);
    },
    onError: reportError,
  });
  // Selama dikte: selalu bertumpuk agar pil mic (lebih lebar) muat.
  const stacked = multiline || dictation.listening;

  /** Lampirkan file yang di-paste (screenshot, file dari file manager). */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...e.clipboardData.files];
      if (files.length === 0) return;
      // Menyalin file dari file manager juga menaruh path/URI-nya sebagai
      // teks di clipboard — cegah paste bawaan agar path tidak ikut masuk
      // ke input; filenya cukup jadi lampiran.
      e.preventDefault();
      addFiles(files);
    },
    [addFiles],
  );

  // `key` tetap: susunan inline <-> stacked menaruh textarea di posisi
  // berbeda; dengan key yang sama React memakai ulang elemennya.
  const textareaEl = (
    <ComposerTextarea
      key="composer-textarea"
      textareaRef={textareaRef}
      value={text}
      stacked={stacked}
      knownPaths={suggestedCacheRef.current}
      knownCommands={slash.known}
      placeholder={composerPlaceholder({
        busy,
        canInput,
        compact: isMobile,
        hasAttachments: pendingImages.length > 0 || elements.length > 0,
        listening: dictation.listening,
      })}
      disabled={!canInput}
      readOnly={dictation.listening}
      onChange={(e) => {
        const caret = e.target.selectionStart ?? e.target.value.length;
        setText(e.target.value);
        mention.onInputChange(e.target.value, caret);
        slash.onInputChange(e.target.value, caret);
      }}
      onKeyDown={(e) => {
        // Dropdown aktif: panah/enter/tab/escape dikelola autocomplete.
        if (slash.handleKeyDown(e)) return;
        if (mention.handleKeyDown(e)) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
      }}
      onPaste={handlePaste}
      onBlur={() => {
        mention.close();
        slash.close();
      }}
    />
  );
  // Slot kirim/stop di baris kontrol: mic (dikte) + kirim/stop. Selama
  // mendengarkan, pil dikte menggantikan keduanya — ✓ di pil sudah berarti
  // kirim.
  const sendOrStopEl = dictation.listening ? (
    <VoiceDictationPill
      key="composer-dictation"
      analyser={dictation.analyser}
      activity={dictation.voiceActivity}
      onCancel={dictation.cancel}
      onFinish={dictation.finish}
    />
  ) : (
    <div key="composer-trailing" className="flex shrink-0 items-center gap-1">
      {!generating && (
        <MicButton
          support={dictation.support}
          disabled={!canInput}
          onClick={() => dictation.start(text)}
        />
      )}
      <SendOrStopButton
        generating={generating}
        hasContent={hasContent}
        canSubmit={canSubmit}
        sending={sending}
        wsStatus={wsStatus}
        onInterrupt={onInterrupt}
      />
    </div>
  );

  return (
    /* Input bebas. `pb-[env(safe-area-inset-bottom)]` menjaga composer tidak
        tertutup home indicator saat dipasang sebagai PWA di HP. */
    // `overflow-y-hidden` + `scrollbar-gutter-stable`: footer mencadangkan
    // lebar scrollbar yang SAMA dengan area scroll timeline di atasnya,
    // sehingga keduanya punya titik tengah horizontal yang sama. Tanpa ini
    // composer tampak bergeser ke kanan dari kolom percakapan.
    <footer className="shrink-0 scrollbar-gutter-stable overflow-y-hidden px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      {/* Pemilih model kini jadi judul header — composer fokus ke input saja
          supaya area mengetik di HP tidak terpotong baris tambahan. */}
      {/* Lebar = lebar TEKS percakapan (`CONVERSATION_MAX_W`), bukan kotak
          timeline — tepi kiri-kanan input sejajar dengan isi chat. */}
      <form
        ref={formRef}
        onSubmit={submitText}
        className={cn("relative mx-auto flex w-full flex-col", CONVERSATION_MAX_W)}
      >
        {/* Pengukur lebar teks satu baris — font identik dengan textarea,
            tak terlihat & tanpa wrap (whitespace-pre) sehingga scrollWidth =
            lebar alami teks. Dipakai keputusan stacked yang stabil. */}
        <span
          ref={measureRef}
          aria-hidden
          className="pointer-events-none absolute top-0 invisible whitespace-pre text-base leading-6"
        />
        {/* Composer compact: image picker di kiri, input prompt di tengah,
            lalu mode agent di kanan. Model tetap dipilih dari header. */}
        <div
          ref={boxRef}
          className={cn(
            "rounded-xl border bg-card/80 p-2 shadow-sm transition-colors",
            "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20",
            !canInput && "opacity-70",
          )}
        >
          {/* Lampiran gambar: di dalam kotak composer, di atas input —
              terbaca sebagai bagian dari pesan yang akan dikirim. */}
          {elements.length > 0 && (
            <DraftElementChips
              elements={elements}
              onRemove={(i) => setElements(elements.filter((_, j) => j !== i))}
            />
          )}
          {pendingImages.length > 0 && (
            <PendingAttachments
              items={pendingImages}
              onRemove={removeAttachment}
              hiddenKeys={plate ? new Set(plate.keys) : undefined}
              registerEl={registerAttachmentEl}
            />
          )}
          {plate?.targets && (
            <DropPlate from={plate.from} items={plate.targets} box={plate.box} onDone={endPlate} />
          )}

          {/* Saran autocomplete di atas kotak composer: slash command (`/` di
              awal pesan) atau @file (token @ aktif). */}
          <ComposerSuggestions
            open={slash.open || mentionOpen}
            anchorRef={boxRef}
            onDismiss={() => {
              slash.close();
              mention.close();
            }}
          >
            {slash.open ? (
              <SlashCommandDropdown
                loading={slash.loading}
                error={slash.error}
                matches={slash.matches}
                highlighted={slash.highlighted}
                onPick={(i) => {
                  const next = slash.pick(i);
                  if (next !== null) applyPicked(next);
                }}
              />
            ) : (
              <FileMentionDropdown
                loading={mention.loading}
                error={mention.error}
                suggestions={mention.suggestions}
                highlighted={mention.highlighted}
                onPick={(i) => {
                  const next = mention.pick(i);
                  if (next !== null) applyPicked(next);
                }}
              />
            )}
          </ComposerSuggestions>

          {isMobile ? (
            <MobileComposerRow
              stacked={stacked}
              disabled={!canInput}
              textarea={textareaEl}
              sendOrStop={sendOrStopEl}
              sheetOpen={actionSheetOpen}
              onSheetOpenChange={setActionSheetOpen}
            >
              <ComposerActionSheet
                disabled={!canInput}
                onPickImage={() => {
                  setActionSheetOpen(false);
                  fileInputRef.current?.click();
                }}
                agentPicker={agentPicker}
                activeAgent={agent}
                onPickAgent={(name) => {
                  setActionSheetOpen(false);
                  void agentPicker.pick(name);
                }}
                permission={
                  hasPermissionModes
                    ? {
                        picker: permissionPicker,
                        active: permissionMode,
                        onPick: (mode) => {
                          setActionSheetOpen(false);
                          void permissionPicker.pick(mode);
                        },
                      }
                    : undefined
                }
              />
            </MobileComposerRow>
          ) : (
            <DesktopComposerRow
              stacked={stacked}
              disabled={!canInput}
              textarea={textareaEl}
              mode={
                <AgentModeSlot
                  permissionPicker={permissionPicker}
                  permissionMode={permissionMode}
                  projectId={session.projectId}
                  agentType={session.agentType}
                  sessionId={session.id}
                  agent={agent}
                  onAgentChange={setAgent}
                  disabled={!canInput}
                />
              }
              sendOrStop={sendOrStopEl}
              onAttach={() => fileInputRef.current?.click()}
            />
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            addFiles(files);
            e.target.value = ""; // izinkan memilih file yang sama lagi
          }}
        />
      </form>
    </footer>
  );
}
