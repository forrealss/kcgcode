/**
 * Engine percakapan Session (headless) — state & efek yang dulu tinggal di
 * `SessionView.tsx`, dipisah menjadi custom hook agar halaman tinggal
 * merender.
 *
 * Konsumen:
 * - `SessionView` — menyusun header/timeline/prompt/composer dari hasil hook.
 * - Koneksi WS (`useWebSocket`) dilampirkan ke `session.id`; `history`,
 *   `message`, `prompt`, `session_status`, dst. diterjemahkan ke state di
 *   sini (daftar pesan, kartu prompt, status Session, error banner).
 *
 * Modul pendukung:
 * - `hooks/session-chat/types.ts` — tipe publik (diekspor ulang di bawah).
 * - `hooks/session-chat/first-prompt.ts` — prompt pertama dari homepage.
 * - `hooks/session-chat/useSessionActions.ts` — resume/stop/hapus Session.
 * - `lib/session-chat.ts` — helper murni (teruji `bun test`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { type CollapsibleState, extendCollapsed, toggleCollapsible } from "@/lib/collapsible";
import { groupPrompts } from "@/lib/prompts";
import {
  appendPrompt,
  hasPendingQuestionPrompt,
  isPromptCardErrorCode,
  isStreamingAssistant,
  thoughtBlockKeys,
} from "@/lib/session-chat";
import { wsStatusLabel } from "@/lib/session-status";
import { appendMessagePartDelta, upsertMessage, upsertMessagePart } from "@/lib/turns";
import type { InteractivePrompt, PromptResponse, SessionMessage, SessionStatus } from "@/types";
import type { ServerMessage } from "@/ws-protocol";
import { useOptimisticFirstPrompt, useSendPendingPrompt } from "./session-chat/first-prompt";
import type { SessionChat, UseSessionChatOptions } from "./session-chat/types";
import { useSessionActions } from "./session-chat/useSessionActions";

export type { SessionChat, UseSessionChatOptions } from "./session-chat/types";

export function useSessionChat({ session, onBack, onDeleted }: UseSessionChatOptions): SessionChat {
  const [serverMessages, setMessages] = useState<SessionMessage[]>([]);
  /** Daftar pesan + pesan user optimistis prompt pertama dari homepage. */
  const messages = useOptimisticFirstPrompt(session.id, serverMessages);
  const [collapsible, setCollapsible] = useState<CollapsibleState>({});
  const [prompts, setPrompts] = useState<InteractivePrompt[]>([]);
  const [status, setStatus] = useState<SessionStatus>(session.status);
  /**
   * Permission mode Session (agent dengan capability `permissionModes`).
   * Ikut berubah bila agent sendiri berganti mode (WS `session_permission_mode`).
   */
  const [permissionMode, setPermissionMode] = useState<string | null>(
    session.permissionMode ?? null,
  );
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Error resolusi prompt — tampil di kartunya (bukan banner global). */
  const [promptError, setPromptError] = useState<string | null>(null);
  /** Turn aktif dari server (`turn_active`): model sedang merespon. */
  const [turnActive, setTurnActive] = useState(false);
  /** `history` sudah diterima — attach selesai, aman mengirim input. */
  const [historyLoaded, setHistoryLoaded] = useState(false);

  /**
   * `onBack` dibaca lewat ref agar handler WS tidak perlu dibuat ulang
   * (dan koneksi WebSocket tidak di-attach ulang) tiap callback berubah.
   */
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case "history":
          setError(null);
          setMessages(msg.messages);
          setPrompts(msg.prompts);
          // Pesan lama tampil penuh; turn tidak mungkin aktif saat reattach.
          setTurnActive(false);
          // Blok "Thought process" di-reset: state collapsible diisi ulang oleh
          // effect sinkronisasi di bawah (default collapsed per turn).
          setCollapsible({});
          setHistoryLoaded(true);
          break;
        case "message":
          setError(null);
          // Replace versi streaming (id sama) atau tambahkan pesan baru.
          setMessages((prev) => upsertMessage(prev, msg.message));
          break;
        case "message_part":
          setError(null);
          // Upsert part streaming (snapshot utuh): opencode mengirimnya saat part
          // dibuat (teks kosong) dan saat selesai (teks lengkap). Isi di
          // antaranya datang lewat `message_part_delta` di bawah.
          setMessages((prev) => upsertMessagePart(prev, msg.sessionId, msg.messageId, msg.part));
          break;
        case "message_part_delta":
          // Token model (opencode `message.part.delta`): teks bertambah per
          // potongan -> efek mengetik seperti TUI opencode.
          setMessages((prev) =>
            appendMessagePartDelta(prev, msg.messageId, msg.partId, msg.field, msg.delta),
          );
          break;
        case "prompt":
          setError(null);
          setPrompts((prev) => appendPrompt(prev, msg.prompt));
          break;
        case "prompt_resolved":
          // Langsung dihapus; animasi keluar kartu ditangani `AnimatePresence`
          // di `PromptPanel` (kartu tetap di DOM sampai animasinya selesai).
          setPrompts((prev) => prev.filter((p) => p.id !== msg.promptId));
          break;
        case "session_status":
          // Kini dikirim ke semua koneksi — abaikan milik Session lain.
          if (msg.sessionId !== session.id) break;
          setStatus(msg.status);
          // Session non-running -> tidak mungkin ada model yang merespon.
          if (msg.status !== "running") {
            setTurnActive(false);
            setCompacting(false);
          }
          break;
        case "session_permission_mode":
          if (msg.sessionId !== session.id) break;
          setPermissionMode(msg.mode);
          break;
        case "session_compaction":
          if (msg.sessionId !== session.id) break;
          setCompacting(msg.compacting);
          break;
        case "turn_active":
          setTurnActive(msg.active);
          break;
        case "session_deleted":
          // Kini dikirim ke semua koneksi — hanya Session ini yang ditinggalkan.
          if (msg.sessionId !== session.id) break;
          // Session dihapus dari tempat lain — kembali ke daftar Session.
          onBackRef.current();
          break;
        case "error":
          // Prompt kedaluwarsa: kartunya sudah dihapus lewat `prompt_resolved`,
          // jadi pesannya tampil di timeline (bukan di kartu — kartu
          // berikutnya tidak boleh mewarisi error ini).
          if (msg.code === "PROMPT_EXPIRED") {
            setError(msg.message);
            break;
          }
          // Error terkait prompt ditampilkan di kartunya masing-masing
          // (lihat `isPromptCardErrorCode`).
          if (isPromptCardErrorCode(msg.code)) {
            setPromptError(msg.message);
            break;
          }
          setError(msg.message);
          break;
      }
      // `session.id` stabil per mount (SessionView di-key per id).
    },
    [session.id],
  );

  const {
    status: wsStatus,
    attach,
    send,
    disconnect,
  } = useWebSocket({
    onMessage,
  });

  useEffect(() => {
    attach(session.id);
    return () => disconnect();
  }, [attach, disconnect, session.id]);

  useSendPendingPrompt({ sessionId: session.id, historyLoaded, wsStatus, send });

  /**
   * Sinkronisasi key collapsible "Thought process": satu blok per turn
   * (id pesan pertama grup), default collapsed. `extendCollapsed` tidak
   * mengubah key yang sudah ada sehingga toggle user tetap dipertahankan
   * saat daftar pesan bertambah/berubah saat streaming.
   */
  useEffect(() => {
    setCollapsible((prev) => extendCollapsed(prev, thoughtBlockKeys(messages)));
  }, [messages]);

  const toggleBlock = useCallback((key: string) => {
    setCollapsible((s) => toggleCollapsible(s, key));
  }, []);

  const consumePromptError = useCallback(() => setPromptError(null), []);

  const resolvePrompt = useCallback(
    (promptId: string, response: PromptResponse) => {
      // Melempar bila tidak terhubung: kartu menangkapnya dan menampilkan
      // error — send() yang diam-diam dibuang membuat tombol terasa mati.
      if (wsStatus !== "connected") {
        throw new Error(`Not connected (${wsStatusLabel(wsStatus)}). Try again.`);
      }
      send({ type: "prompt_response", sessionId: session.id, promptId, response });
    },
    [send, session.id, wsStatus],
  );

  const reportError = useCallback((message: string | null) => setError(message), []);

  /**
   * Hentikan balasan model (interrupt ala opencode) — Session tetap aktif.
   * Server membuang parts turn parsial (tidak disimpan), dan di sini kita
   * juga membersihkan respon parsial yang sudah tampil di UI agar hilang
   * dari percakapan (pesan user & turn sebelumnya tetap utuh).
   */
  const interrupt = useCallback(() => {
    send({ type: "interrupt", sessionId: session.id });
    setMessages((prev) => prev.filter((m) => !isStreamingAssistant(m)));
    setTurnActive(false);
  }, [send, session.id]);

  const {
    starting,
    start,
    stopping,
    stop,
    deleteOpen,
    beginDelete,
    cancelDelete,
    deleting,
    confirmDelete,
  } = useSessionActions({ sessionId: session.id, onBack, onDeleted, setError });

  /**
   * Model sedang merespon: server melaporkan turn aktif (`turn_active`), atau
   * masih ada pesan assistant `streaming` yang belum digantikan versi final
   * (fallback saat reattach di tengah turn).
   */
  const busy = turnActive || messages.some(isStreamingAssistant);
  const generating = busy && status === "running";
  // Saat model merespon input dinonaktifkan — satu-satunya aksi adalah Stop.
  const canInput = wsStatus === "connected" && status === "running" && !busy;

  /**
   * Grup prompt pending untuk panel floating di atas composer — permission
   * identik (kind+title sama) digroup jadi SATU kartu (bug kartu nyepam).
   */
  const promptGroups = useMemo(() => groupPrompts(prompts), [prompts]);
  /** Ada question pending? (lihat `hasPendingQuestionPrompt` di `lib/session-chat`). */
  const hasPendingQuestion = useMemo(() => hasPendingQuestionPrompt(prompts), [prompts]);

  return {
    wsStatus,
    send,
    status,
    permissionMode,
    setPermissionMode,
    compacting,
    busy,
    generating,
    canInput,
    error,
    reportError,
    messages,
    historyLoaded,
    collapsible,
    toggleBlock,
    prompts,
    promptGroups,
    hasPendingQuestion,
    promptError,
    consumePromptError,
    resolvePrompt,
    interrupt,
    starting,
    start,
    stopping,
    stop,
    deleteOpen,
    beginDelete,
    cancelDelete,
    deleting,
    confirmDelete,
  };
}
