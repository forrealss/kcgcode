/**
 * Composer input Session — textarea prompt, lampiran gambar, @file
 * autocomplete, mode agent, serta tombol kirim/stop.
 *
 * Seluruh state input (teks, gambar pending, mention, agent mode) hidup di
 * komponen ini; engine (`useSessionChat`) hanya menyuplai izin input & kanal
 * kirim. Saat model merespon tombol kirim berubah jadi tombol Stop
 * (mengirim `{ type: "interrupt" }`) — menghentikan balasan saja,
 * Session tetap berjalan.
 *
 * UI punya dua varian:
 * - Desktop: attach image | textarea | AgentPicker | kirim/stop.
 * - Mobile: satu tombol aksi (attach image + agent mode) lewat `Sheet`;
 *   saat input lebih dari satu baris, textarea pindah ke baris sendiri.
 */
import { ImagePlusIcon, PlusIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentPicker } from "@/components/sessions/AgentPicker";
import { ComposerActionSheet } from "@/components/sessions/ComposerActionSheet";
import { FileMentionDropdown } from "@/components/sessions/FileMentionDropdown";
import { type PendingImage, PendingImageThumbs } from "@/components/sessions/PendingImageThumbs";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useAgentPicker } from "@/hooks/useAgentPicker";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useFileMention } from "@/hooks/useMention";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import { ApiError, apiErrorMessage, apiUploadImage } from "@/lib/api";
import { composerPlaceholder, extractMentionedFiles } from "@/lib/composer";
import { cn } from "@/lib/utils";
import type { Session } from "@/types";
import type { ClientMessage } from "@/ws-protocol";

export interface SessionComposerProps {
  session: Session;
  /** Engine: input boleh dipakai (koneksi + Session running + tidak sibuk). */
  inputAllowed: boolean;
  /** Model sedang merespon (untuk placeholder & tombol Stop). */
  busy: boolean;
  /** Model merespon DAN Session berjalan — kirim berubah jadi Stop. */
  generating: boolean;
  wsStatus: WsConnectionStatus;
  /** Kirim pesan Client -> Server (engine). */
  send: (msg: ClientMessage) => void;
  /** Set error banner global (upload/kirim gagal). */
  reportError: (message: string | null) => void;
  /** Hentikan balasan model (interrupt) — Session tetap aktif. */
  onInterrupt: () => void;
}

export function SessionComposer({
  session,
  inputAllowed,
  busy,
  generating,
  wsStatus,
  send,
  reportError,
  onInterrupt,
}: SessionComposerProps) {
  /** Layar sempit: placeholder composer dipendekkan agar tidak terpotong. */
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  /**
   * Gambar yang akan dilampirkan ke pesan berikutnya (belum di-upload).
   * Preferensi thumbnail memakai object URL lokal; upload terjadi saat kirim.
   */
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  /** Upload lampiran sedang berjalan — cegah kirim ganda. */
  const [sending, setSending] = useState(false);
  /**
   * Input butuh lebih dari satu baris — tombol aksi & kirim/stop pindah ke
   * baris di bawah textarea (ala Gemini), di desktop maupun mobile.
   */
  const [multiline, setMultiline] = useState(false);
  /** Sheet aksi mobile (attach image + agent mode) di tombol tunggal kiri input. */
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  /** Agent (mode) pilihan Session — build/plan/agent kustom; null = default. */
  const [agent, setAgent] = useState<string | null>(session.agent);
  /**
   * Fetch + pick daftar agent untuk Sheet aksi mobile — dipakai langsung
   * (tanpa nested popover) supaya tap satu mode langsung menerapkannya.
   */
  const agentPicker = useAgentPicker(session.projectId, session.id, setAgent);
  // Muat daftar agent begitu Sheet aksi mobile pertama dibuka (lazy, sama
  // seperti popover AgentPicker di desktop).
  useEffect(() => {
    if (actionSheetOpen) agentPicker.load();
  }, [actionSheetOpen, agentPicker.load]);
  /**
   * Autocomplete `@file`: deteksi token @query di sekitar kursor + daftar
   * saran dari server (index file milik opencode, seperti `@` di TUI-nya).
   */
  const mention = useFileMention({ endpoint: `/api/sessions/${session.id}/files` });
  /**
   * Terapkan teks hasil pemilihan saran (keyboard maupun mouse) ke state
   * input + kembalikan fokus ke textarea.
   */
  const applyPicked = useCallback((next: string) => {
    setText(next);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);
  useEffect(() => mention.setOnPick(applyPicked), [mention, applyPicked]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  /** Pengukur lebar teks satu baris — font identik dengan textarea. */
  const measureRef = useRef<HTMLSpanElement | null>(null);
  /**
   * Perkiraan lebar kontrol yang berbagi baris dengan textarea saat inline —
   * SENGAJA dilebihkan (attach + agent + kirim di desktop; plus + kirim di
   * mobile) agar teks di dekat batas selalu dianggap multiline, bukan
   * pas-pasan (sumber flip-flop). Mobile lebih kecil karena barisnya hanya
   * dua tombol.
   */
  const INLINE_CONTROLS_RESERVE_PX = isMobile ? 88 : 192;
  /**
   * Putuskan `multiline` dari LEBAR TEKS terhadap lebar baris inline — BUKAN
   * dari scrollHeight textarea. Mengukur tinggi membuat keputusan bergantung
   * pada layout AKTIF: teks yang wrap di baris inline (sempit, dipotong
   * tombol) bisa muat satu baris saat stacked (lebar penuh) → stacked →
   * remeasure muat → inline → wrap lagi → … (flip-flop tiap ketik). Lebar
   * teks (span tersembunyi) vs lebar form TIDAK berubah saat layout
   * berganti, sehingga keputusannya selalu titik tetap yang stabil.
   */
  const updateMultiline = useCallback(() => {
    const span = measureRef.current;
    const form = formRef.current;
    if (span === null || form === null) return;
    const inlineTextWidth =
      form.clientWidth -
      16 /* p-2 kontainer */ -
      16 /* px-2 textarea */ -
      INLINE_CONTROLS_RESERVE_PX;
    setMultiline(span.scrollWidth > inlineTextWidth);
  }, [INLINE_CONTROLS_RESERVE_PX]);
  /** Tumbuhkan tinggi textarea mengikuti isi (maks lewat CSS max-h). */
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  // Sinkronkan pengukur lebar + keputusan stacked + tinggi textarea untuk
  // perubahan `text` apa pun (ketik, autocomplete @file, reset kirim).
  useLayoutEffect(() => {
    const span = measureRef.current;
    if (span !== null) span.textContent = text;
    updateMultiline();
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [text, updateMultiline, autoResize]);
  // Lebar form berubah (resize window / orientasi HP) → keputusan stacked
  // dihitung ulang terhadap lebar terbaru.
  useEffect(() => {
    const form = formRef.current;
    if (form === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateMultiline);
    observer.observe(form);
    return () => observer.disconnect();
  }, [updateMultiline]);

  /** Cache path yang pernah disarankan autocomplete (validitas @ref saat kirim). */
  const suggestedCacheRef = useRef<Set<string>>(new Set());
  if (mention.suggestions.length > 0) {
    for (const s of mention.suggestions) suggestedCacheRef.current.add(s);
  }

  /** Ukuran maksimum gambar yang diterima (mengikuti limit opencode 20 MiB). */
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

  /**
   * Terima file gambar dari file picker / paste, validasi, lalu simpan ke
   * antrean lampiran. Format non-gambar / terlalu besar ditolak dengan pesan.
   */
  const addImages = useCallback(
    (files: Iterable<File>) => {
      const picked: PendingImage[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          reportError(`"${file.name}" is not an image.`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          reportError(`"${file.name}" exceeds the 20 MiB limit.`);
          continue;
        }
        picked.push({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
      }
      if (picked.length > 0) setPendingImages((prev) => [...prev, ...picked]);
    },
    [reportError],
  );

  const removeImage = useCallback((key: string) => {
    setPendingImages((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }, []);

  /**
   * Input dapat dipakai = izin engine (koneksi + running + tidak busy) DAN
   * tidak sedang upload lampiran.
   */
  const canInput = inputAllowed && !sending;
  const canSubmit = canInput && (text.trim() !== "" || pendingImages.length > 0);

  const submitText = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canInput || sending) return;
    if (text.trim() === "" && pendingImages.length === 0) return;
    setSending(true);
    try {
      // Referensi @path dikenal dijadikan part `file` — teks asli tidak
      // diubah (tetap tampil di bubble); part `file` hanya penanda tambahan
      // agar isi file benar-benar dibaca opencode.
      const files = extractMentionedFiles(text, suggestedCacheRef.current);
      // Upload gambar dulu; id lampiran dipakai pesan WS berikutnya.
      const images: string[] = [];
      for (const img of pendingImages) {
        const up = await apiUploadImage(`/api/sessions/${session.id}/uploads`, img.file);
        images.push(up.id);
      }
      send({ type: "input", sessionId: session.id, text: text.trim(), files, images });
      for (const img of pendingImages) URL.revokeObjectURL(img.previewUrl);
      setPendingImages([]);
      setText("");
      mention.close();
    } catch (e) {
      reportError(e instanceof ApiError ? e.message : apiErrorMessage("ERROR"));
    } finally {
      setSending(false);
    }
  };

  /** Lampirkan gambar yang di-paste (mis. screenshot) ke pesan berikutnya. */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
      if (files.length > 0) addImages(files);
    },
    [addImages],
  );

  return (
    /* Input bebas. `pb-[env(safe-area-inset-bottom)]` menjaga composer tidak
        tertutup home indicator saat dipasang sebagai PWA di HP. */
    <footer className="shrink-0 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      {/* Pemilih model kini jadi judul header — composer fokus ke input saja
          supaya area mengetik di HP tidak terpotong baris tambahan. */}
      {/* Composer sejajar dengan kolom percakapan, sedikit lebih sempit dari
          kolom timeline agar terasa fokus (ala Gemini). */}
      <form
        ref={formRef}
        onSubmit={submitText}
        className="relative mx-auto flex w-full max-w-2xl flex-col"
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
          className={cn(
            "rounded-xl border bg-card/80 p-2 shadow-sm transition-colors",
            "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20",
            !canInput && "opacity-70",
          )}
        >
          {/* Dropdown saran @file (muncul di atas input saat token @ aktif). */}
          {mention.mention !== null && (mention.suggestions.length > 0 || mention.loading) && (
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

          {(() => {
            // Ala Gemini: begitu input tumbuh ke 2 baris (multiline), tombol
            // aksi & kirim/stop pindah ke baris di BAWAH textarea — berlaku
            // di desktop maupun mobile. Satu baris: semuanya dalam satu baris.
            const stacked = multiline;

            const textareaEl = (
              <textarea
                key="composer-textarea"
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  mention.onInputChange(
                    e.target.value,
                    e.target.selectionStart ?? e.target.value.length,
                  );
                }}
                onKeyDown={(e) => {
                  // Dropdown aktif: panah/enter/tab/escape dikelola autocomplete.
                  if (mention.handleKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                onPaste={handlePaste}
                onBlur={() => mention.close()}
                placeholder={composerPlaceholder({ busy, canInput, compact: isMobile })}
                aria-label="Free-form input"
                disabled={!canInput}
                rows={1}
                className={cn(
                  "max-h-40 min-h-9 min-w-0 resize-none border-0 bg-transparent px-2 py-1.5 text-base leading-6 shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed",
                  stacked ? "w-full" : "flex-1 self-center",
                )}
              />
            );

            const sendOrStopEl = generating ? (
              // Saat model merespon: tombol kirim berubah jadi tombol Stop
              // (hentikan balasan saja, Session tetap aktif ala opencode).
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
            ) : (
              // Tombol kirim baru muncul setelah user mengisi prompt.
              text.trim() !== "" && (
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
              )
            );

            // Mobile: satu tombol aksi (attach image + agent mode) lewat Sheet,
            // supaya baris composer HP tetap ringkas (3 elemen saja).
            if (isMobile) {
              const actionTrigger = (
                <SheetTrigger asChild key="composer-actions-trigger">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!canInput}
                    aria-label="More actions"
                    title="Attach image or change agent mode"
                    className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <PlusIcon data-icon="inline-start" />
                  </Button>
                </SheetTrigger>
              );

              return (
                <Sheet open={actionSheetOpen} onOpenChange={setActionSheetOpen}>
                  <div className={cn("flex gap-1", stacked ? "flex-col" : "items-center")}>
                    {stacked ? (
                      <>
                        {textareaEl}
                        <div className="flex items-center justify-between gap-1">
                          {actionTrigger}
                          {sendOrStopEl}
                        </div>
                      </>
                    ) : (
                      <>
                        {actionTrigger}
                        {textareaEl}
                        {sendOrStopEl}
                      </>
                    )}
                  </div>
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
                  />
                </Sheet>
              );
            }

            // Desktop: attach image, agent mode, dan kirim/stop tetap tampil
            // langsung sebagai kontrol terpisah di toolbar composer. Satu
            // baris: semuanya sejajar; multiline: kontrol turun ke bawah
            // textarea (ala Gemini).
            const attachImageEl = (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canInput}
                aria-label="Attach image"
                title="Attach image (PNG/JPEG/GIF/WebP, max 20 MiB)"
                className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <ImagePlusIcon data-icon="inline-start" />
              </Button>
            );

            const agentPickerEl = (
              <AgentPicker
                projectId={session.projectId}
                sessionId={session.id}
                agent={agent}
                onChanged={setAgent}
                disabled={!canInput}
              />
            );

            if (stacked) {
              return (
                <div className="flex flex-col gap-1">
                  {textareaEl}
                  <div className="flex items-center justify-between gap-1">
                    {attachImageEl}
                    <div className="flex items-center gap-1">
                      {agentPickerEl}
                      {sendOrStopEl}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div className="flex items-center gap-1">
                {attachImageEl}
                {textareaEl}
                {agentPickerEl}
                {sendOrStopEl}
              </div>
            );
          })()}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            addImages(files);
            e.target.value = ""; // izinkan memilih file yang sama lagi
          }}
        />
      </form>
      {/* Pratinjau gambar yang akan dilampirkan (bisa dihapus sebelum kirim). */}
      {pendingImages.length > 0 && (
        <PendingImageThumbs images={pendingImages} onRemove={removeImage} />
      )}
    </footer>
  );
}
