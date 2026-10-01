/**
 * Timeline percakapan terstruktur: daftar pesan yang dapat di-scroll dengan
 * tombol "kembali ke bawah", maskot global, serta catatan error/empty/status.
 *
 * Dipisah dari `SessionView` agar halaman hanya menyusun area; pemetaan
 * pesan -> grup turn & status maskot dihitung di sini dari `messages` murni
 * (`lib/turns.ts`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import type { CollapsibleState } from "@/lib/collapsible";
import { TIMELINE_MAX_W } from "@/lib/layout";
import { groupTurns, lastAssistantGroup, textOf, turnStatus } from "@/lib/turns";
import { cn } from "@/lib/utils";
import type { SessionMessage, SessionStatus } from "@/types";
import { AssistantTurn } from "./AssistantTurn";
import { Mascot } from "./Mascot";
import { MessageRail, type UserMessageMark } from "./MessageRail";
import { UserMessage } from "./UserMessage";

export interface SessionTimelineProps {
  /** Error banner global (bukan error kartu prompt). */
  error: string | null;
  /** Status Session saat ini (catatan "Session stopped…" di bawah). */
  status: SessionStatus;
  messages: SessionMessage[];
  /** Status toggle blok "Thought process" per turn. */
  collapsible: CollapsibleState;
  onToggle: (key: string) => void;
  /** Model sedang merespon (turn aktif + Session running). */
  generating: boolean;
}

export function SessionTimeline({
  error,
  status,
  messages,
  collapsible,
  onToggle,
  generating,
}: SessionTimelineProps) {
  /**
   * Ambang "menempel ke bawah" (dan kemunculan tombol panah) = setinggi SATU
   * viewport. Tinggi area scroll diukur dinamis (bukan angka tetap) agar
   * perilakunya benar di tiap ukuran layar / saat tinggi area berubah (mis.
   * composer membesar).
   */
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const update = () => setViewportHeight(viewport.clientHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const groups = useMemo(() => groupTurns(messages), [messages]);
  const lastTurn = lastAssistantGroup(groups);

  /**
   * Penanda rail: satu per pesan user, dengan cuplikan teks untuk tooltip.
   * Pesan tanpa teks (mis. lampiran saja) tetap dapat penanda.
   */
  const marks = useMemo<UserMessageMark[]>(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((m) => {
          const text = textOf(m.parts).trim().replace(/\s+/g, " ");
          return {
            id: m.id,
            preview: text === "" ? "Attachment" : text.slice(0, 120),
          };
        }),
    [messages],
  );

  /** Elemen tiap pesan user (target observer & tujuan lompat). */
  const markEls = useRef(new Map<string, HTMLElement>());
  const [activeMark, setActiveMark] = useState<string | null>(null);

  // Penanda aktif = pesan user paling bawah yang bagian atasnya sudah lewat
  // (atau dekat) tepi atas viewport — itulah bagian percakapan yang sedang
  // dibaca. Dihitung dari rect, tidak menyimpan state scroll sendiri.
  const syncActive = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const top = viewport.getBoundingClientRect().top;
    let current: string | null = null;
    for (const mark of marks) {
      const el = markEls.current.get(mark.id);
      if (el && el.getBoundingClientRect().top - top <= 24) current = mark.id;
    }
    setActiveMark(current ?? marks[0]?.id ?? null);
  }, [marks]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null || marks.length < 2) return;
    syncActive();
    // `passive`: handler hanya membaca rect, tidak pernah preventDefault.
    viewport.addEventListener("scroll", syncActive, { passive: true });
    return () => viewport.removeEventListener("scroll", syncActive);
  }, [marks.length, syncActive]);

  const registerMarkEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) markEls.current.set(id, el);
    else markEls.current.delete(id);
  }, []);

  const jumpTo = useCallback((id: string) => {
    const el = markEls.current.get(id);
    const viewport = viewportRef.current;
    if (!el || !viewport) return;
    // Lompat dengan sedikit ruang di atas agar pesan tidak menempel ke tepi.
    const offset = el.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.scrollTo({ top: viewport.scrollTop + offset - 16, behavior: "smooth" });
  }, []);

  /**
   * Maskot GLOBAL (satu instance, bukan per-turn): status dihitung dari grup
   * assistant yang masih LIVE (sedang streaming) dan ditampilkan tetap di atas
   * composer — tidak ikut scroll bersama riwayat percakapan.
   *
   * Turn lama yang sudah selesai TIDAK ikut menentukan status: begitu user
   * mengirim pesan baru, grup assistant terakhir masih milik jawaban
   * sebelumnya — tanpa filter ini maskot langsung menampilkan "Writing…"
   * (dari jawaban lama) padahal model belum mulai merespons. Belum ada
   * konten baru -> "Starting…" (lihat fallback di bawah).
   */
  const liveTurn = lastTurn?.messages.some((m) => m.streaming === true) ? lastTurn : null;
  const mascotStatus = generating
    ? ((liveTurn ? turnStatus(liveTurn.messages, true) : null) ?? "Starting…")
    : null;

  return (
    // `autoScroll` bawaan provider DIMATIKAN: mesinnya menempel ke dasar setiap
    // kali tinggi konten berubah — termasuk saat user membuka/menutup blok
    // "Thought process" (state collapsible) sehingga layar terseret ke bawah.
    // Penggantinya `AutoScrollFollow` di bawah: hanya mengikuti saat isi
    // TIMELINE bertambah (pesan baru/streaming/status/error), bukan saat
    // toggle collapsible. `scrollEdgeThreshold` tetap dipakai untuk ambang
    // tombol panah (1 viewport).
    <MessageScrollerProvider autoScroll={false} scrollEdgeThreshold={viewportHeight}>
      {/* Pengganti auto-follow bawaan — lihat komentar komponen di bawah. */}
      <AutoScrollFollow
        messages={messages}
        status={status}
        error={error}
        viewportRef={viewportRef}
      />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport ref={viewportRef}>
          {/* `TIMELINE_MAX_W mx-auto`: di layar lebar baris teks yang membentang
              penuh sulit dibaca; kolom percakapan dibatasi dan dipusatkan
              seperti aplikasi chat lain, sementara scrollbar tetap di tepi. */}
          <MessageScrollerContent
            className={cn("mx-auto w-full gap-6 px-3 py-4 sm:gap-8 sm:px-4", TIMELINE_MAX_W)}
          >
            {error && (
              <MessageScrollerItem messageId="error">
                <p className="text-sm text-destructive">{error}</p>
              </MessageScrollerItem>
            )}
            {groups.map((group) =>
              group.kind === "user" ? (
                <div
                  key={group.message.id}
                  ref={(el) => registerMarkEl(group.message.id, el)}
                  // `scroll-mt-4`: cadangan bila lompat dilakukan browser.
                  className="scroll-mt-4"
                >
                  <UserMessage message={group.message} />
                </div>
              ) : (
                <AssistantTurn
                  key={group.id}
                  group={group}
                  collapsible={collapsible}
                  onToggle={onToggle}
                />
              ),
            )}
            {/* Maskot GLOBAL — selalu menjadi item paling bawah di scroller,
                ikut scroll bersama konten (ala Claude). Status:
                - "Starting…" saat generating tapi respons belum datang
                - mascotStatus (Working/Thinking/Writing/tool) saat ada turn aktif
                - standby (logo diam) setelah selesai, selama ada riwayat */}
            {messages.length > 0 && (
              <MessageScrollerItem messageId="mascot">
                <Mascot
                  label={generating ? (mascotStatus ?? "Starting…") : null}
                  active={generating}
                  standby
                  className="px-1"
                />
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {/* Rail penanda pesan user (tepi kiri area percakapan). */}
        <MessageRail marks={marks} activeId={activeMark} onJump={jumpTo} />
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

interface AutoScrollFollowProps {
  /** Perubahan pada prop berikut yang boleh memicu auto-follow ke bawah. */
  messages: SessionMessage[];
  status: SessionStatus;
  error: string | null;
  viewportRef: { current: HTMLDivElement | null };
}

/**
 * Pengganti `autoScroll` bawaan MessageScroller (yang dimatikan di provider).
 *
 * Aturan UX:
 * - Selama pengguna masih kurang dari satu layar di atas dasar percakapan
 *   (tombol panah belum muncul), isi timeline yang BERTAMBAH — respon baru /
 *   pesan streaming / catatan status — tetap memaksa scroll ke dasar.
 * - Setelah scroll ke atas satu layar penuh atau lebih, konten baru TIDAK
 *   menarik layar (tombol panah yang mengembalikannya).
 * - Membuka/menutup blok "Thought process" TIDAK memicu scroll: toggle hanya
 *   mengubah state collapsible (bukan `messages`/`status`/`error`), jadi efek
 *   ini tidak berjalan dan posisi baca pengguna tetap dipertahankan.
 *
 * Scroll hanya dijalankan bila tinggi konten benar-benar bertambah (perubahan
 * pesan yang tidak mengubah layout — mis. part tool di blok yang masih
 * collapsed — tidak boleh menarik layar).
 */
function AutoScrollFollow({ messages, status, error, viewportRef }: AutoScrollFollowProps) {
  const { scrollToEnd } = useMessageScroller();
  /** scrollHeight dari commit terakhir — baseline deteksi konten bertambah. */
  const lastContentHeightRef = useRef<number | null>(null);

  // Dipicu hanya saat isi timeline berubah (pesan/status/error) — bukan saat
  // toggle collapsible. Diletakkan SEBELUM efek baseline di bawah: di commit
  // yang sama ia membaca tinggi konten dari commit SEBELUMNYA.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `messages`/`status`/`error` sengaja jadi trigger — keputusan scroll dibaca dari DOM (scrollHeight/scrollTop), bukan dari nilai closure.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const previousHeight = lastContentHeightRef.current;
    const grew = previousHeight === null || viewport.scrollHeight > previousHeight;
    if (!grew) return;
    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceToBottom <= viewport.clientHeight) scrollToEnd();
  }, [messages, status, error, viewportRef, scrollToEnd]);

  // Baseline tinggi konten selalu diperbarui di setiap commit — termasuk saat
  // toggle collapsible / resize — agar commit pesan berikutnya dibandingkan
  // dengan tinggi yang benar.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport !== null) lastContentHeightRef.current = viewport.scrollHeight;
  });

  return null;
}
