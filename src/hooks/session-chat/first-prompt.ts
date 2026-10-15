/**
 * Prompt pertama dari chat homepage (`HomeChat`) di Session view: tampil
 * optimistis sejak frame pertama, lalu dikirim sekali setelah attach WS
 * selesai. Bagian dari `useSessionChat` — dipanggil pada posisi yang sama
 * dalam urutan hook/effect aslinya.
 */
import { useEffect, useMemo, useState } from "react";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import { peekPendingPrompt, setPendingPrompt, takePendingPrompt } from "@/lib/pending-prompt";
import { createOptimisticMessage } from "@/lib/session-chat";
import type { SessionMessage } from "@/types";
import type { ClientMessage } from "@/ws-protocol";

/**
 * Gabungkan pesan server dengan pesan user optimistis (bila ada) dan
 * kembalikan daftar pesan yang dirender.
 */
export function useOptimisticFirstPrompt(
  sessionId: string,
  serverMessages: SessionMessage[],
): SessionMessage[] {
  /**
   * Prompt pertama dari homepage langsung tampil sebagai pesan user sejak
   * frame pertama — layout Session view sudah dalam bentuk percakapan
   * (composer di dasar) saat View Transition memotret halaman tujuan, dan
   * user tidak melihat kilatan "No conversation yet". Dilepas begitu echo
   * pesan user asli (id server) tiba.
   */
  const [optimistic, setOptimistic] = useState<SessionMessage | null>(() => {
    const text = peekPendingPrompt(sessionId);
    return text === null ? null : createOptimisticMessage(sessionId, text);
  });
  const hasRealUser = serverMessages.some((m) => m.role === "user");
  const messages = useMemo(
    () => (optimistic && !hasRealUser ? [optimistic, ...serverMessages] : serverMessages),
    [optimistic, hasRealUser, serverMessages],
  );
  // Echo asli tiba -> buang pesan optimistis.
  useEffect(() => {
    if (optimistic && hasRealUser) setOptimistic(null);
  }, [optimistic, hasRealUser]);
  return messages;
}

interface SendPendingPromptOptions {
  sessionId: string;
  historyLoaded: boolean;
  wsStatus: WsConnectionStatus;
  send: (msg: ClientMessage) => boolean;
}

/**
 * Prompt pertama dari chat homepage (`HomeChat`): dikirim sekali setelah
 * attach selesai (`history` diterima). `takePendingPrompt` menghapusnya
 * sehingga tidak terkirim ulang saat reconnect / remount.
 */
export function useSendPendingPrompt({
  sessionId,
  historyLoaded,
  wsStatus,
  send,
}: SendPendingPromptOptions): void {
  useEffect(() => {
    if (!historyLoaded || wsStatus !== "connected") return;
    const text = takePendingPrompt(sessionId);
    if (text === null) return;
    // Socket belum siap -> kembalikan agar dicoba lagi saat terhubung ulang.
    if (!send({ type: "input", sessionId, text })) setPendingPrompt(sessionId, text);
  }, [historyLoaded, wsStatus, send, sessionId]);
}
