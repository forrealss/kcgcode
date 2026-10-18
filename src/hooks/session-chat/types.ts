/**
 * Tipe publik engine percakapan Session (`useSessionChat`). Diekspor ulang
 * dari `hooks/useSessionChat.ts` — konsumen tetap mengimpor dari sana.
 */
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import type { CollapsibleState } from "@/lib/collapsible";
import type {
  InteractivePrompt,
  PromptResponse,
  Session,
  SessionMessage,
  SessionStatus,
} from "@/types";
import type { ClientMessage } from "@/ws-protocol";

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
  /** `false` = koneksi belum siap (pesan tidak terkirim). */
  send: (msg: ClientMessage) => boolean;
  status: SessionStatus;
  /** Permission mode Session (null = default agent) — tersinkron dari WS. */
  permissionMode: string | null;
  setPermissionMode: (mode: string | null) => void;
  /** Agent sedang meringkas riwayat (compact) — WS `session_compaction`. */
  compacting: boolean;
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
  /**
   * Riwayat awal (`history`) sudah diterima dari server. Sebelum ini,
   * `messages` kosong BUKAN berarti percakapan kosong — UI menampilkan
   * kerangka loading, bukan empty-state "No conversation yet".
   */
  historyLoaded: boolean;
  /** Status toggle blok "Thought process" per turn. */
  collapsible: CollapsibleState;
  toggleBlock: (key: string) => void;

  // Prompt pending
  prompts: InteractivePrompt[];
  /** Prompt pending yang digroup (kind + title identik) jadi satu kartu. */
  promptGroups: InteractivePrompt[][];
  /** Ada question pending — composer digantikan panel question docked. */
  hasPendingQuestion: boolean;
  promptError: string | null;
  consumePromptError: () => void;
  /** Prompt yang sedang memainkan animasi keluar sebelum dihapus. */
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
