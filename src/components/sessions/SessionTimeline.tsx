/**
 * Timeline percakapan terstruktur: daftar pesan yang dapat di-scroll dengan
 * tombol "kembali ke bawah", maskot global, serta catatan error/empty/status.
 *
 * Dipisah dari `SessionView` agar halaman hanya menyusun area; pemetaan
 * pesan -> grup turn & status maskot dihitung di sini dari `messages` murni
 * (`lib/turns.ts`).
 */
import { useMemo } from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
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
  const groups = useMemo(() => groupTurns(messages), [messages]);
  const lastTurn = lastAssistantGroup(groups);

  /**
   * Maskot GLOBAL (satu instance, bukan per-turn): status dihitung dari
   * grup assistant TERAKHIR saja, ditampilkan tetap di atas composer —
   * tidak ikut scroll bersama riwayat percakapan.
   */
  const mascotStatus = generating
    ? ((lastTurn ? turnStatus(lastTurn.messages, true) : null) ?? "Working…")
    : null;

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
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
