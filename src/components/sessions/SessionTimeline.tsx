/**
 * Timeline percakapan terstruktur: daftar pesan yang dapat di-scroll dengan
 * tombol "kembali ke bawah", maskot global, serta catatan error/empty/status.
 *
 * Dipisah dari `SessionView` agar halaman hanya menyusun area; pemetaan
 * pesan -> grup turn & status maskot dihitung di sini dari `messages` murni
 * (`lib/turns.ts`).
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { groupTurns, lastAssistantGroup, turnStatus } from "@/lib/turns";
import type { SessionMessage, SessionStatus } from "@/types";
import { AssistantTurn } from "./AssistantTurn";
import { Mascot } from "./Mascot";
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
          {/* `max-w-3xl mx-auto`: di layar lebar baris teks yang membentang
              penuh sulit dibaca; kolom percakapan dibatasi dan dipusatkan
              seperti aplikasi chat lain, sementara scrollbar tetap di tepi. */}
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-3 py-4 sm:gap-8 sm:px-4">
            {error && (
              <MessageScrollerItem messageId="error">
                <p className="text-sm text-destructive">{error}</p>
              </MessageScrollerItem>
            )}
            {messages.length === 0 ? (
              <MessageScrollerItem messageId="empty">
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No conversation yet. Send the first message to get started.
                </p>
              </MessageScrollerItem>
            ) : (
              groups.map((group) =>
                group.kind === "user" ? (
                  <UserMessage key={group.message.id} message={group.message} />
                ) : (
                  <AssistantTurn
                    key={group.id}
                    group={group}
                    collapsible={collapsible}
                    onToggle={onToggle}
                  />
                ),
              )
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
            {status !== "running" && messages.length > 0 && (
              <MessageScrollerItem messageId="status-note">
                <p className="text-xs text-muted-foreground">
                  Session {status}. Input is disabled.
                </p>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
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
