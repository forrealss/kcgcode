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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket, type WsConnectionStatus } from "@/hooks/useWebSocket";
import { ApiError, apiFetch, getAuthToken } from "@/lib/api";
import { type CollapsibleState, extendCollapsed, toggleCollapsible } from "@/lib/collapsible";
import { groupPrompts } from "@/lib/prompts";
import { wsStatusLabel } from "@/lib/session-status";
import {
  groupTurns,
  turnBlocks,
  turnSegments,
  upsertMessage,
  upsertMessagePart,
} from "@/lib/turns";
import type {
  InteractivePrompt,
  PromptResponse,
  Session,
  SessionMessage,
  SessionStatus,
} from "@/types";
import type { ClientMessage, ServerMessage } from "@/ws-protocol";

/** Durasi animasi keluar kartu prompt (slide-down + fade) dalam ms. */
const PROMPT_EXIT_MS = 220;

export interface UseSessionChatOptions {
  session: Session;
  onBack: () => void;
  /** Dipanggil setelah Session dihapus dari menu aksi header. */
  onDeleted?: () => void;
}

export interface SessionChat {
  // Koneksi & status
  wsStatus: WsConnectionStatus;
  /** Kirim pesan Client -> Server (dipakai composer untuk `input`/`interrupt`). */
  send: (msg: ClientMessage) => void;
  status: SessionStatus;
  /** Model sedang merespon: turn aktif atau masih ada pesan streaming. */
  busy: boolean;
  /** Model sedang merespon DAN Session berjalan (untuk tombol Stop). */
  generating: boolean;
  /** Input dapat dipakai (koneksi + Session running + tidak sibuk). */
  canInput: boolean;
  error: string | null;
  /** Set error banner global (dipakai composer saat upload/kirim gagal). */
  reportError: (message: string | null) => void;

  // Data percakapan
  messages: SessionMessage[];
  /** Status toggle blok "Thought process" per turn. */
  collapsible: CollapsibleState;
  toggleBlock: (key: string) => void;

  // Prompt pending
  prompts: InteractivePrompt[];
  /** Prompt pending yang digroup (kind + title identik) jadi satu kartu. */
  promptGroups: InteractivePrompt[][];
  promptError: string | null;
  consumePromptError: () => void;
  /** Prompt yang sedang memainkan animasi keluar sebelum dihapus. */
  resolving: Set<string>;
  resolvePrompt: (promptId: string, response: PromptResponse) => void;

  // Aksi Session
  interrupt: () => void;
  starting: boolean;
  start: () => Promise<void>;
  stopping: boolean;
  stop: () => Promise<void>;
  /** Dialog konfirmasi hapus Session (dirender `SessionView`). */
  deleteOpen: boolean;
  beginDelete: () => void;
  cancelDelete: () => void;
  deleting: boolean;
  confirmDelete: () => Promise<void>;
}

export function useSessionChat({ session, onBack, onDeleted }: UseSessionChatOptions): SessionChat {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [collapsible, setCollapsible] = useState<CollapsibleState>({});
  const [prompts, setPrompts] = useState<InteractivePrompt[]>([]);
  const [status, setStatus] = useState<SessionStatus>(session.status);
  const [error, setError] = useState<string | null>(null);
  /** Error resolusi prompt — tampil di kartunya (bukan banner global). */
  const [promptError, setPromptError] = useState<string | null>(null);
  /** Prompt yang dijawab & sedang memainkan animasi keluar. */
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  /** Turn aktif dari server (`turn_active`): model sedang merespon. */
  const [turnActive, setTurnActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * `onBack` dibaca lewat ref agar handler WS tidak perlu dibuat ulang
   * (dan koneksi WebSocket tidak di-attach ulang) tiap callback berubah.
   */
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const onMessage = useCallback((msg: ServerMessage) => {
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
        break;
      case "message":
        setError(null);
        // Replace versi streaming (id sama) atau tambahkan pesan baru.
        setMessages((prev) => upsertMessage(prev, msg.message));
        break;
      case "message_part":
        setError(null);
        // Upsert part streaming: teks yang tiba bertahap langsung tampil di layar
        // (provider yang men-stream token); yang tiba sekaligus di pesan final
        // (provider non-streaming) muncul penuh saat versi final menggantikan
        // placeholder streaming ini — tanpa efek mengetik.
        setMessages((prev) => upsertMessagePart(prev, msg.sessionId, msg.messageId, msg.part));
        break;
      case "prompt":
        setError(null);
        setPrompts((prev) =>
          prev.some((p) => p.id === msg.prompt.id) ? prev : [...prev, msg.prompt],
        );
        break;
      case "prompt_resolved":
        // Kartu diberi jeda EXIT_MS untuk animasi keluar (slide-down + fade)
        // sebelum benar-benar dihapus dari daftar.
        setResolving((prev) => new Set(prev).add(msg.promptId));
        setTimeout(() => {
          setPrompts((prev) => prev.filter((p) => p.id !== msg.promptId));
          setResolving((prev) => {
            const next = new Set(prev);
            next.delete(msg.promptId);
            return next;
          });
        }, PROMPT_EXIT_MS);
        break;
      case "session_status":
        setStatus(msg.status);
        // Session non-running -> tidak mungkin ada model yang merespon.
        if (msg.status !== "running") setTurnActive(false);
        break;
      case "turn_active":
        setTurnActive(msg.active);
        break;
      case "session_deleted":
        // Session dihapus dari tempat lain — kembali ke daftar Session.
        onBackRef.current();
        break;
      case "error":
        // Error terkait prompt ditampilkan di kartunya masing-masing —
        // banner global di atas chat tidak terlihat oleh user yang sedang
        // fokus ke kartu (tombol terasa "mati" tanpa feedback).
        if (
          msg.code === "PROMPT_NOT_FOUND" ||
          msg.code === "PROMPT_ALREADY_RESOLVED" ||
          msg.code === "PROMPT_FAILED"
        ) {
          setPromptError(msg.message);
          break;
        }
        setError(msg.message);
        break;
    }
  }, []);

  const {
    status: wsStatus,
    attach,
    send,
    disconnect,
  } = useWebSocket({
    token: getAuthToken() ?? undefined,
    onMessage,
  });

  useEffect(() => {
    attach(session.id);
    return () => disconnect();
  }, [attach, disconnect, session.id]);

  /**
   * Sinkronisasi key collapsible "Thought process": satu blok per turn
   * (id pesan pertama grup), default collapsed. `extendCollapsed` tidak
   * mengubah key yang sudah ada sehingga toggle user tetap dipertahankan
   * saat daftar pesan bertambah/berubah saat streaming.
   */
  useEffect(() => {
    setCollapsible((prev) => {
      const keys: string[] = [];
      for (const g of groupTurns(messages)) {
        if (g.kind !== "assistant") continue;
        if (
          !g.messages.some((m) => m.parts.some((p) => p.type === "reasoning" || p.type === "tool"))
        )
          continue;
        const segs = turnSegments(g.messages);
        for (const block of turnBlocks(segs)) {
          if (block.steps.length > 0) keys.push(`${g.id}:${block.key}`);
        }
      }
      return extendCollapsed(prev, keys);
    });
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
    setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.streaming === true)));
    setTurnActive(false);
  }, [send, session.id]);

  /** Resume via API langsung — hasil status baru tiba via WS `session_status`. */
  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "POST" });
      // Status baru dikirim gateway ke semua subscriber; tak perlu setState di sini.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to start session");
    } finally {
      setStarting(false);
    }
  }, [session.id]);

  /**
   * Hentikan Session (bukan hanya balasan model): status -> `stopped`.
   * Berbeda dari tombol Stop di composer yang hanya meng-interrupt turn.
   */
  const stop = useCallback(async () => {
    setStopping(true);
    setError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}/stop`, { method: "POST" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to stop session");
    } finally {
      setStopping(false);
    }
  }, [session.id]);

  /** Hapus Session permanen dari menu aksi header (dikonfirmasi lebih dulu). */
  const beginDelete = useCallback(() => setDeleteOpen(true), []);
  const cancelDelete = useCallback(() => setDeleteOpen(false), []);
  const confirmDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      (onDeleted ?? onBack)();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete session");
    } finally {
      setDeleting(false);
    }
  }, [session.id, onBack, onDeleted]);

  /**
   * Model sedang merespon: server melaporkan turn aktif (`turn_active`), atau
   * masih ada pesan assistant `streaming` yang belum digantikan versi final
   * (fallback saat reattach di tengah turn).
   */
  const busy = turnActive || messages.some((m) => m.role === "assistant" && m.streaming === true);
  const generating = busy && status === "running";
  // Saat model merespon input dinonaktifkan — satu-satunya aksi adalah Stop.
  const canInput = wsStatus === "connected" && status === "running" && !busy;

  /**
   * Grup prompt pending untuk panel floating di atas composer — permission
   * identik (kind+title sama) digroup jadi SATU kartu (bug kartu nyepam).
   */
  const promptGroups = useMemo(() => groupPrompts(prompts), [prompts]);

  return {
    wsStatus,
    send,
    status,
    busy,
    generating,
    canInput,
    error,
    reportError,
    messages,
    collapsible,
    toggleBlock,
    prompts,
    promptGroups,
    promptError,
    consumePromptError,
    resolving,
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
