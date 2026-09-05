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
 * Konsumen `useWebSocket.ts`:
 * - `history` (reattach) berisi `messages` + `prompts` pending.
 * - `message` menambah pesan baru; `prompt`/`prompt_resolved` mengelola kartu.
 * - `session_status` memperbarui badge; `turn_active` status model merespon;
 *   `error` ditampilkan.
 */
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckBigIcon,
  ClockFadingIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  ImagePlusIcon,
  type LucideIcon,
  MoonIcon,
  MoreVerticalIcon,
  PenLineIcon,
  PlayIcon,
  SearchIcon,
  SendHorizontalIcon,
  SquareIcon,
  SunIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { MarkdownContent } from "@/components/sessions/MarkdownContent";
import { ModelPicker } from "@/components/sessions/ModelPicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useFileMention } from "@/hooks/useMention";
import { useTheme } from "@/hooks/useTheme";
import { useWebSocket, type WsConnectionStatus } from "@/hooks/useWebSocket";
import {
  ApiError,
  apiErrorMessage,
  apiFetch,
  apiUploadImage,
  attachmentUrl,
  getAuthToken,
} from "@/lib/api";
import { composerPlaceholder } from "@/lib/composer";
import { cn } from "@/lib/utils";
import type {
  InteractivePrompt,
  MessagePart,
  PromptResponse,
  Session,
  SessionMessage,
  SessionModel,
  SessionStatus,
} from "@/types";
import type { ServerMessage } from "@/ws-protocol";
import {
  type CollapsibleState,
  extendCollapsed,
  isCollapsibleExpanded,
  toggleCollapsible,
} from "./CollapsibleState";
import { Mascot } from "./Mascot";
import { PromptCard } from "./PromptCard";

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

function wsStatusLabel(status: WsConnectionStatus): string {
  switch (status) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting…";
    case "reconnecting":
      return "reconnecting…";
    default:
      return "disconnected";
  }
}

function statusVariant(status: SessionStatus): "default" | "secondary" | "destructive" {
  if (status === "running") return "default";
  if (status === "crashed") return "destructive";
  return "secondary";
}

/** Warna titik status Session di header HP (sepadan dengan `SessionList`). */
const STATUS_DOT: Record<SessionStatus, string> = {
  running: "bg-emerald-500",
  stopped: "bg-muted-foreground/50",
  crashed: "bg-destructive",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function partText(p: MessagePart): string | null {
  return typeof p.text === "string" ? p.text : null;
}

/**
 * Gabungkan teks jawaban dari part `text` saja — reasoning/tool/step tidak
 * ikut, walau part tersebut juga membawa field `text` dari opencode.
 */
export function textOf(parts: MessagePart[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map(partText)
    .filter((t): t is string => t !== null)
    .join("\n");
}

/** Satu segmen render turn assistant (urut sesuai alur kerja model). */
export type TurnSegment =
  | { kind: "reasoning"; key: string; part: MessagePart }
  | { kind: "tool"; key: string; part: MessagePart }
  | { kind: "error"; key: string; part: MessagePart }
  | {
      kind: "text";
      key: string;
      text: string /** Jawaban akhir turn (bukan interim). */;
      final: boolean;
    };

/**
 * Ratakan seluruh parts satu turn (bisa beberapa pesan assistant) menjadi
 * daftar segmen BERURUTAN: setiap part reasoning jadi satu segmen Thinking
 * tersendiri (bisa tampil lebih dari sekali, sesuai urutan berpikir model),
 * tool jadi segmen badge, part `text` berurutan digabung, dan segmen teks
 * non-kosong TERAKHIR ditandai `final` (jawaban akhir — satu-satunya yang
 * dapat efek typewriter).
 */
export function turnSegments(messages: readonly SessionMessage[]): TurnSegment[] {
  const segments: TurnSegment[] = [];
  for (const msg of messages) {
    msg.parts.forEach((part, i) => {
      const key = `${msg.id}:${part.id ?? i}`;
      if (part.type === "reasoning" || part.type === "error") {
        segments.push({ kind: part.type, key, part });
        return;
      }
      if (part.type === "tool" || part.type === "shell" || part.type === "file") {
        segments.push({ kind: "tool", key, part });
        return;
      }
      if (part.type !== "text") return;
      const text = partText(part) ?? "";
      const last = segments[segments.length - 1];
      // Part text berdempetan digabung agar tidak pecah jadi beberapa bubble.
      if (last?.kind === "text") last.text = last.text === "" ? text : `${last.text}\n${text}`;
      else segments.push({ kind: "text", key, text, final: false });
    });
  }
  // Segmen teks non-kosong terakhir = jawaban akhir turn.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg?.kind !== "text") continue;
    if (seg.text.trim() !== "") seg.final = true;
    break;
  }
  return segments;
}

/** Key kandidat `state.input` tool yang berisi target utama (path/argumen). */
const TOOL_TARGET_KEYS = [
  "filePath",
  "path",
  "file",
  "dir",
  "directory",
  "pattern",
  "query",
  "url",
  "command",
  "description",
] as const;

/**
 * Target utama sebuah tool call (mis. path file yang di-read) — diambil
 * dari `state.input` part tool opencode dengan toleransi beberapa nama key.
 * Part `file` (echo @file) memakai `filename`-nya langsung.
 */
export function toolTarget(part: MessagePart): string | null {
  if (part.type === "file" && typeof part.filename === "string" && part.filename.trim() !== "") {
    return part.filename;
  }
  const state = part.state;
  if (typeof state !== "object" || state === null) return null;
  const input = (state as { input?: unknown }).input;
  if (typeof input !== "object" || input === null) return null;
  for (const key of TOOL_TARGET_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/** Label badge tool: nama tool + target (mis. `read package.json`). */
export function toolLabel(part: MessagePart): string {
  const name = typeof part.tool === "string" && part.tool.trim() !== "" ? part.tool : part.type;
  const target = toolTarget(part);
  return target === null ? name : `${name} ${target}`;
}

/** Ikon badge tool mengikuti nama tool (fallback: kunci inggris). */
const TOOL_ICONS: Record<string, LucideIcon> = {
  read: FileIcon,
  list: FolderIcon,
  glob: FolderIcon,
  edit: PenLineIcon,
  write: PenLineIcon,
  patch: PenLineIcon,
  bash: TerminalIcon,
  shell: TerminalIcon,
  grep: SearchIcon,
  webfetch: GlobeIcon,
};

function toolIcon(part: MessagePart): LucideIcon {
  const name = (typeof part.tool === "string" ? part.tool : part.type).toLowerCase();
  return (name !== "" && TOOL_ICONS[name]) || WrenchIcon;
}

/** Sekelompok pesan assistant berurutan dari satu turn balasan model. */
export interface AssistantTurnGroup {
  kind: "assistant";
  /** Id pesan pertama — dipakai sebagai key React & key collapsible turn. */
  id: string;
  messages: SessionMessage[];
}

export type MessageGroup = { kind: "user"; message: SessionMessage } | AssistantTurnGroup;

/**
 * Kelompokkan pesan berurutan: assistant yang berdempetan (satu turn —
 * sering dipecah opencode menjadi beberapa `msg_...` saat reasoning/tool/
 * sub-agent) menjadi SATU grup sehingga tampil sebagai satu kesatuan;
 * pesan user selalu grup tersendiri.
 */
export function groupTurns(messages: readonly SessionMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (m.role === "assistant") {
      if (last?.kind === "assistant") last.messages.push(m);
      else groups.push({ kind: "assistant", id: m.id, messages: [m] });
    } else {
      groups.push({ kind: "user", message: m });
    }
  }
  return groups;
}

/**
 * Apakah satu turn sudah menampilkan sesuatu ke user: reasoning non-kosong,
 * tool call, error, maupun teks. Dipakai untuk memutuskan kapan indikator
 * "Memproses…" perlu tampil (respon masih kosong sama sekali).
 */
export function hasVisibleContent(segments: readonly TurnSegment[]): boolean {
  return segments.some(
    (s) =>
      s.kind === "tool" ||
      s.kind === "error" ||
      (s.kind === "reasoning" && (partText(s.part) ?? "").trim() !== "") ||
      (s.kind === "text" && s.text.trim() !== ""),
  );
}

/**
 * Status LIVE satu turn untuk maskot (murni, diuji):
 * - `null`       -> turn belum ada / selesai (maskot disembunyikan).
 * - "Memproses…" -> belum ada konten apa pun (baru mulai).
 * - "Thinking…"  -> reasoning part terakhir masih berjalan.
 * - "Writing…"   -> model sedang menulis jawaban (segmen teks terakhir tampil).
 * - lainnya      -> label tool yang sedang dijalankan (mis. "read package.json").
 *
 * Catatan: akhir turn ditandai `streaming=false` (pesan final menggantikan
 * versi streaming), jadi penilaian "selesai" cukup dari flag itu.
 */
export function turnStatus(messages: readonly SessionMessage[], streaming: boolean): string | null {
  if (!streaming || messages.length === 0) return null;
  const segments = turnSegments(messages);
  if (!hasVisibleContent(segments)) return "Working…";
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!seg) continue;
    if (seg.kind === "text") return "Writing…";
    if (seg.kind === "reasoning") return "Thinking…";
    if (seg.kind === "tool") return toolLabel(seg.part);
    // error: proses berhenti di error -> selesai.
    return null;
  }
  return "Working…";
}

/**
 * Total durasi thinking (ms) dari satu turn — dipakai untuk label "thoughts Xs"
 * di footer setelah turn selesai.
 *
 * Strategi (urut prioritas):
 * 1. Pakai `time.start`/`time.end` dari `ReasoningPart` asli opencode jika ada.
 * 2. Fallback ke `time.start` part pertama vs `time.end` part terakhir dari
 *    seluruh parts reasoning yang ada (estimasi kasar).
 * 3. Jika tidak ada timing sama sekali, kembalikan null.
 */
export function turnThoughtDuration(messages: readonly SessionMessage[]): number | null {
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "reasoning") continue;
      const t = part.time;
      if (!t) continue;
      const start = t.start ?? t.created;
      if (typeof start === "number") {
        if (earliest === null || start < earliest) earliest = start;
      }
      const end = t.end;
      if (typeof end === "number") {
        if (latest === null || end > latest) latest = end;
      }
    }
  }
  if (earliest !== null && latest !== null && latest > earliest) {
    return latest - earliest;
  }
  return null;
}

/**
 * Format durasi ms ke string ringkas: "1s", "12s", "1m 5s".
 */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

/**
 * Kelompokkan segmen satu turn menjadi blok berurutan untuk render in-order.
 * Setiap blok berisi kluster steps (reasoning/tool) opsional diikuti teks/error
 * opsional. Ini memungkinkan pola multi-round:
 *   [thinking] → [text] → [thinking] → [text]
 * dirender sebagai beberapa "Thought process" terpisah, bukan satu blok di atas.
 */
export interface TurnBlock {
  /** Key unik blok (dari key segmen pertama). */
  key: string;
  steps: Extract<TurnSegment, { kind: "reasoning" | "tool" }>[];
  /** Teks atau error setelah kluster steps ini (bisa null kalau blok masih streaming). */
  content: Extract<TurnSegment, { kind: "text" | "error" }> | null;
}

export function turnBlocks(segments: readonly TurnSegment[]): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let pendingSteps: Extract<TurnSegment, { kind: "reasoning" | "tool" }>[] = [];

  for (const seg of segments) {
    if (seg.kind === "reasoning" || seg.kind === "tool") {
      pendingSteps.push(seg);
    } else if (seg.kind === "text" || seg.kind === "error") {
      blocks.push({
        key: pendingSteps[0]?.key ?? seg.key,
        steps: pendingSteps,
        content: seg,
      });
      pendingSteps = [];
    }
  }
  // Steps tersisa tanpa teks (masih streaming atau turn selesai tanpa teks akhir)
  const firstPending = pendingSteps[0];
  if (firstPending) {
    blocks.push({ key: firstPending.key, steps: pendingSteps, content: null });
  }
  return blocks;
}

/**
 * Baris ringkas isi reasoning di timeline. Saat masih di-stream (teks belum
 * lengkap) tampil redup; setelah selesai tampil apa adanya — keduanya bisa
 * panjang, jadi tinggi dibatasi + scroll internal.
 */
function ReasoningStep({ text }: { text: string }) {
  const dim = text.trim() === "";
  return (
    <div
      className={cn(
        "max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed",
        dim && "text-muted-foreground/50",
      )}
    >
      {dim ? "organizing thoughts…" : text}
    </div>
  );
}

/**
 * Upsert satu part ke dalam daftar pesan (streaming, event `message_part`).
 * - Belum ada pesan dengan `messageId` -> buat placeholder assistant streaming.
 * - Sudah ada -> part dengan `id` sama diganti, selainnya ditambahkan.
 * Mengembalikan array baru (immutable) agar mudah diverifikasi.
 */
export function upsertMessagePart(
  messages: SessionMessage[],
  sessionId: string,
  messageId: string,
  part: MessagePart,
): SessionMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) {
    return [
      ...messages,
      {
        id: messageId,
        sessionId,
        role: "assistant",
        parts: [part],
        createdAt: Date.now(),
        streaming: true,
      },
    ];
  }
  const cur = messages[idx];
  if (!cur) return messages;
  const partIdx = cur.parts.findIndex((p) => p.id !== undefined && p.id === part.id);
  const nextParts =
    partIdx === -1 ? [...cur.parts, part] : cur.parts.map((p, i) => (i === partIdx ? part : p));
  const next: SessionMessage = { ...cur, parts: nextParts, streaming: true };
  return messages.map((m, i) => (i === idx ? next : m));
}

/**
 * Ganti pesan final (hasil POST, non-streaming) — replace bila id sama
 * (menutup versi streaming), selainnya tambahkan.
 */
export function upsertMessage(
  messages: SessionMessage[],
  message: SessionMessage,
): SessionMessage[] {
  const idx = messages.findIndex((m) => m.id === message.id);
  if (idx === -1) return [...messages, message];
  return messages.map((m, i) => (i === idx ? message : m));
}

export function SessionView({ session, onBack, onDeleted }: SessionViewProps) {
  /** Layar sempit: placeholder composer dipendekkan agar tidak terpotong. */
  const isMobile = useIsMobile();
  /** Toggle tema dari menu aksi header (sebelumnya hanya ada di AppShell). */
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [collapsible, setCollapsible] = useState<CollapsibleState>({});
  const [prompts, setPrompts] = useState<InteractivePrompt[]>([]);
  const [status, setStatus] = useState<SessionStatus>(session.status);
  /** Model pilihan Session — dapat diganti live; null = default opencode. */
  const [model, setModel] = useState<SessionModel | null>(session.model);
  const [error, setError] = useState<string | null>(null);
  /**
   * Turn aktif dari server (`turn_active`): model sedang merespon. Fallback
   * klien: pesan assistant `streaming` (lihat `busy`).
   */
  const [turnActive, setTurnActive] = useState(false);
  const [text, setText] = useState("");
  /**
   * Gambar yang akan dilampirkan ke pesan berikutnya (belum di-upload).
   * Preferensi thumbnail memakai object URL lokal; upload terjadi saat kirim.
   */
  const [pendingImages, setPendingImages] = useState<
    { key: string; file: File; previewUrl: string }[]
  >([]);
  /** Upload lampiran sedang berjalan — cegah kirim ganda. */
  const [sending, setSending] = useState(false);
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
  /** Tumbuhkan tinggi textarea mengikuti isi (maks lewat CSS max-h). */
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
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
        setPrompts((prev) => prev.filter((p) => p.id !== msg.promptId));
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
        setError(msg.message);
        break;
    }
  }, []);

  /**
   * `onBack` dibaca lewat ref agar handler WS tidak perlu dibuat ulang
   * (dan koneksi WebSocket tidak di-attach ulang) tiap callback berubah.
   */
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

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

  const resolvePrompt = useCallback(
    (promptId: string, response: PromptResponse) => {
      send({ type: "prompt_response", sessionId: session.id, promptId, response });
    },
    [send, session.id],
  );

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
  const addImages = useCallback((files: Iterable<File>) => {
    const picked: { key: string; file: File; previewUrl: string }[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError(`"${file.name}" is not an image.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" exceeds the 20 MiB limit.`);
        continue;
      }
      picked.push({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
    }
    if (picked.length > 0) setPendingImages((prev) => [...prev, ...picked]);
  }, []);

  const removeImage = useCallback((key: string) => {
    setPendingImages((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }, []);

  const submitText = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canInput || sending) return;
    if (text.trim() === "" && pendingImages.length === 0) return;
    setSending(true);
    try {
      /**
       * Referensi @path yang dikenal diekstrak menjadi daftar `files` — tapi
       * teks TIDAK diubah. Teks asli tetap tampil di bubble chat (termasuk
       * `@path`-nya); part `file` di prompt opencode hanya penanda tambahan
       * agar isi file benar-benar dibaca.
       */
      const files: string[] = [];
      for (const match of text.matchAll(/(^|\s)@([^\s]+)/g)) {
        const path = match[2] ?? "";
        if (path.length > 0 && (suggestedCacheRef.current.has(path) || path.includes("/"))) {
          files.push(path);
        }
      }
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
      setError(e instanceof ApiError ? e.message : apiErrorMessage("ERROR"));
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

  /**
   * Hentikan balasan model (interrupt ala opencode) — Session tetap aktif.
   * Server membuang parts turn parsial (tidak disimpan), dan di sini kita
   * juga membersihkan respon parsial yang sudah tampil di UI agar hilang
   * dari percakapan (pesan user & turn sebelumnya tetap utuh).
   */
  const interrupt = () => {
    send({ type: "interrupt", sessionId: session.id });
    setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.streaming === true)));
    setTurnActive(false);
  };

  /** Resume via API langsung — hasil status baru tiba via WS `session_status`. */
  const [starting, setStarting] = useState(false);
  const start = async () => {
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
  };

  /**
   * Hentikan Session (bukan hanya balasan model): status -> `stopped`.
   * Berbeda dari tombol Stop di composer yang hanya meng-interrupt turn.
   */
  const [stopping, setStopping] = useState(false);
  const stopSession = async () => {
    setStopping(true);
    setError(null);
    try {
      await apiFetch(`/api/sessions/${session.id}/stop`, { method: "POST" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to stop session");
    } finally {
      setStopping(false);
    }
  };

  /** Hapus Session permanen dari menu aksi header (dikonfirmasi lebih dulu). */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = async () => {
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
  };

  /**
   * Model sedang merespon: server melaporkan turn aktif (`turn_active`), atau
   * masih ada pesan assistant `streaming` yang belum digantikan versi final
   * (fallback saat reattach di tengah turn).
   */
  const busy = turnActive || messages.some((m) => m.role === "assistant" && m.streaming === true);
  const generating = busy && status === "running";
  // Saat model merespon input dinonaktifkan — satu-satunya aksi adalah Stop.
  const canInput = wsStatus === "connected" && status === "running" && !sending && !busy;
  const canSubmit = canInput && (text.trim() !== "" || pendingImages.length > 0);

  /**
   * Maskot GLOBAL (satu instance, bukan per-turn): status dihitung dari
   * grup assistant TERAKHIR saja, ditampilkan tetap di atas composer —
   * tidak ikut scroll bersama riwayat percakapan.
   */
  const lastGroup = groupTurns(messages).findLast(
    (g): g is AssistantTurnGroup => g.kind === "assistant",
  );
  const mascotStatus = generating
    ? ((lastGroup ? turnStatus(lastGroup.messages, true) : null) ?? "Working…")
    : null;

  const toggleMessage = (key: string) => {
    setCollapsible((s) => toggleCollapsible(s, key));
  };

  /**
   * Satu langkah timeline di dalam blok "Thought process": ikon status di
   * kiri (dengan garis penghubung antar langkah) + isi di kanan.
   *
   * Garis digambar ABSOLUT (bukan flex-1 di kolom stretch): `align-self:
   * stretch` hanya membentang sampai content box sehingga di langkah
   * satu-baris sisa ruang garisnya ~0px (tak terlihat). Absolut terhadap
   * PADDING box -> `bottom-0` menyentuh dasar `pb-5`, artinya garis selalu
   * tersambung ke langkah berikutnya berapa pun tinggi kontennya.
   */
  const renderTimelineStep = (
    icon: ReactNode,
    content: ReactNode,
    opts?: { last?: boolean; streaming?: boolean },
  ) => (
    <div className={cn("relative flex gap-2.5", !opts?.last && "pb-5")}>
      {/* Garis penghubung: mulai tepat di bawah ikon (mt-0.5 + size-5 =
          22px) sampai dasar row; x=10px = pusat kolom ikon (size-5). */}
      {!opts?.last && (
        <span className="absolute top-6 bottom-0 left-2.5 -ml-px w-px bg-border" aria-hidden />
      )}
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          opts?.streaming && "animate-pulse text-foreground/70",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm text-muted-foreground">{content}</div>
    </div>
  );

  /** Ikon kecil (14px) untuk langkah timeline & indikator status. */
  const stepIcon = (Icon: LucideIcon, className?: string) => (
    <Icon className={cn("size-3.5 shrink-0", className)} data-icon="inline-start" />
  );

  /** Satu kesatuan respon: header + blok Thought process per round + jawaban. */
  const renderAssistantTurn = (group: AssistantTurnGroup) => {
    const m = group.messages[0];
    if (!m) return null;
    const segments = turnSegments(group.messages);
    const streaming = m.streaming === true || group.messages.some((msg) => msg.streaming === true);
    const blocks = turnBlocks(segments);
    // Durasi thinking untuk footer — hanya dihitung setelah turn selesai.
    const thoughtMs = !streaming ? turnThoughtDuration(group.messages) : null;

    /** Render satu blok "Thought process" collapsible dari kluster steps. */
    const renderThoughtBlock = (
      steps: Extract<TurnSegment, { kind: "reasoning" | "tool" }>[],
      blockKey: string,
      isLastBlock: boolean,
    ) => {
      if (steps.length === 0) return null;
      // Key collapsible per blok: gabungkan group.id + blockKey agar tiap blok
      // bisa toggle independen.
      const collapsibleKey = `${group.id}:${blockKey}`;
      const expanded = isCollapsibleExpanded(collapsible, collapsibleKey);
      // Blok terakhir yang masih streaming: "Done" belum tampil.
      const blockStreaming = streaming && isLastBlock;
      return (
        <Collapsible key={collapsibleKey} open={expanded}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 self-start gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => toggleMessage(collapsibleKey)}
            aria-expanded={expanded}
          >
            <ChevronRightIcon
              data-icon="inline-start"
              className={cn("transition-transform", expanded && "rotate-90")}
            />
            Thought process
          </Button>
          <CollapsibleContent>
            <div className="flex flex-col px-3 pt-1">
              {steps.map((seg, i) =>
                seg.kind === "reasoning" ? (
                  <div key={seg.key}>
                    {renderTimelineStep(
                      stepIcon(ClockFadingIcon, "text-muted-foreground"),
                      <ReasoningStep text={partText(seg.part) ?? ""} />,
                      {
                        last: blockStreaming && i === steps.length - 1,
                        streaming: blockStreaming && i === steps.length - 1,
                      },
                    )}
                  </div>
                ) : (
                  <div key={seg.key}>
                    {renderTimelineStep(
                      stepIcon(toolIcon(seg.part), "text-muted-foreground"),
                      <span className="font-mono text-[13px]">{toolLabel(seg.part)}</span>,
                      { last: blockStreaming && i === steps.length - 1, streaming: false },
                    )}
                  </div>
                ),
              )}
              {!blockStreaming &&
                renderTimelineStep(
                  stepIcon(CircleCheckBigIcon, "text-muted-foreground"),
                  <span>Done</span>,
                  { last: true },
                )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      );
    };

    return (
      <Message key={group.id} align="start">
        <MessageContent>
          {blocks.map((block, bi) => {
            const isLastBlock = bi === blocks.length - 1;
            return (
              <div key={block.key}>
                {/* Thought process block — pisah per round thinking */}
                {renderThoughtBlock(block.steps, block.key, isLastBlock)}
                {/* Konten teks/error setelah thinking round ini */}
                {block.content?.kind === "error" && (
                  <Bubble key={block.content.key} variant="destructive">
                    <BubbleContent>
                      <div className="flex gap-2">
                        <CircleAlertIcon
                          className="mt-0.5 size-4 shrink-0"
                          data-icon="inline-start"
                        />
                        <span className="whitespace-pre-wrap">
                          {partText(block.content.part) ??
                            "Something went wrong while processing the prompt."}
                        </span>
                      </div>
                    </BubbleContent>
                  </Bubble>
                )}
                {block.content?.kind === "text" && block.content.text !== "" && (
                  <Bubble key={block.content.key} variant="ghost" className="max-w-full">
                    <BubbleContent className="w-full">
                      <MarkdownContent>{block.content.text}</MarkdownContent>
                    </BubbleContent>
                  </Bubble>
                )}
              </div>
            );
          })}
          {/* Footer: tersembunyi saat streaming, muncul dengan animasi fade +
              slide dari kanan setelah turn selesai. Format:
              HH:MM:SS · ● · thoughts Xs */}
          {!streaming && (
            <MessageFooter className="animate-in fade-in-0 slide-in-from-right-4 duration-500">
              {formatTime(m.createdAt)}
              {thoughtMs !== null && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40" aria-hidden>
                    ●
                  </span>
                  <span>thoughts {formatDuration(thoughtMs)}</span>
                </>
              )}
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    );
  };

  const renderMessageGroup = (group: MessageGroup): ReactNode =>
    group.kind === "user" ? renderUserMessage(group.message) : renderAssistantTurn(group);

  /** Part `file` yang merupakan gambar lampiran (punya attachmentId + mime image). */
  const isImageAttachment = (
    p: MessagePart,
  ): p is MessagePart & { mime: string; attachmentId: string } => {
    return (
      p.type === "file" &&
      typeof p.mime === "string" &&
      p.mime.startsWith("image/") &&
      typeof p.attachmentId === "string"
    );
  };

  const renderUserMessage = (m: SessionMessage) => {
    const images = m.parts.filter(isImageAttachment);
    const attachedFiles = m.parts
      .map((p) => ({ part: p, filename: p.filename }))
      .filter(
        (x): x is { part: MessagePart; filename: string } =>
          x.part.type === "file" && !isImageAttachment(x.part) && typeof x.filename === "string",
      );
    return (
      <Message key={m.id} align="end">
        <MessageContent>
          <Bubble>
            <BubbleContent className="whitespace-pre-wrap">{textOf(m.parts)}</BubbleContent>
            {images.length > 0 && (
              <div className="mt-1.5 grid max-w-xs grid-cols-2 gap-1.5">
                {images.map((p) => (
                  <img
                    key={p.attachmentId}
                    src={attachmentUrl(m.sessionId, p.attachmentId)}
                    alt={p.filename ?? "attached image"}
                    className="max-h-40 w-full rounded-md border object-contain"
                    loading="lazy"
                  />
                ))}
              </div>
            )}
            {attachedFiles.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {attachedFiles.map(({ filename }) => (
                  <span
                    key={filename}
                    className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    <FileIcon className="size-3 shrink-0" />
                    <span className="truncate">{filename}</span>
                  </span>
                ))}
              </div>
            )}
          </Bubble>
          <MessageFooter>{formatTime(m.createdAt)}</MessageFooter>
        </MessageContent>
      </Message>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        Header ala aplikasi chat mobile: back — nama model (pembuka picker) —
        aksi. Nama model jadi judul karena itulah informasi yang paling sering
        dilihat & diganti; identitas Session (agentType + id) turun ke baris
        kedua yang hanya tampil di layar lebar.

        Tiga tombol saja di HP supaya lega: back, play/stop, dan menu aksi.
      */}
      <header className="shrink-0 border-b">
        {/* Garis border membentang penuh, isinya sejajar kolom percakapan. */}
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-1.5 py-1.5 sm:gap-2 sm:px-3 sm:py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back"
            className="size-10 shrink-0 sm:size-9"
          >
            <ChevronLeftIcon data-icon="inline-start" />
          </Button>

          {/* Judul = nama model, sekaligus pembuka dialog pemilihan model.
            Ikon chevron memberi tahu bahwa ini dapat diganti. */}
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <ModelPicker
              projectId={session.projectId}
              sessionId={session.id}
              model={model}
              onChanged={setModel}
              variant="heading"
            />
            <span className="hidden truncate px-2 font-mono text-[11px] text-muted-foreground sm:block">
              {session.agentType} · {session.id.slice(0, 8)}
              {wsStatus !== "connected" && ` · ${wsStatusLabel(wsStatus)}`}
            </span>
          </div>

          {/* Play/stop Session — aksi paling sering dipakai, jadi tetap di luar
            menu. Stop hanya untuk Session yang berjalan; saat model sedang
            merespon, penghentian balasan ada di composer (tombol Stop). */}
          {status === "running" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void stopSession()}
              disabled={stopping}
              aria-label="Stop session"
              title="Stop session"
              className="size-10 shrink-0 sm:size-9"
            >
              {stopping ? <Spinner className="size-4" /> : <SquareIcon />}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void start()}
              disabled={starting}
              aria-label="Start session"
              title="Start session"
              className="size-10 shrink-0 sm:size-9"
            >
              {starting ? <Spinner className="size-4" /> : <PlayIcon />}
            </Button>
          )}

          {/* Status Session sebagai titik berwarna di HP (badge teks memakan
            lebar); badge penuh muncul dari breakpoint sm. */}
          <span
            role="status"
            className="flex shrink-0 items-center sm:hidden"
            title={`Session ${status}`}
          >
            <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
            <span className="sr-only">Session {status}</span>
          </span>
          <Badge variant={statusVariant(status)} className="hidden shrink-0 sm:inline-flex">
            {status}
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Session actions"
                className="size-10 shrink-0 sm:size-9"
              >
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={toggleTheme}>
                {isDark ? <SunIcon /> : <MoonIcon />}
                {isDark ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2Icon />
                Delete session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Percakapan terstruktur.
          Padding horizontal ada di Content (bukan Viewport) supaya scrollbar
          tetap menempel di tepi, sementara bubble & footer waktu punya jarak
          dari pinggir layar — di HP sebelumnya keduanya mepet ke tepi. */}
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
              {messages.length === 0 && prompts.length === 0 ? (
                <MessageScrollerItem messageId="empty">
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No conversation yet. Send the first message to get started.
                  </p>
                </MessageScrollerItem>
              ) : (
                groupTurns(messages).map((group) => renderMessageGroup(group))
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
              {prompts.map((prompt) => (
                <MessageScrollerItem key={prompt.id} messageId={prompt.id}>
                  <PromptCard prompt={prompt} onResolve={(r) => resolvePrompt(prompt.id, r)} />
                </MessageScrollerItem>
              ))}
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

      {/* Input bebas. `pb-[env(safe-area-inset-bottom)]` menjaga composer tidak
          tertutup home indicator saat dipasang sebagai PWA di HP. */}
      <footer className="shrink-0 border-t px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
        {/* Pemilih model kini jadi judul header — composer fokus ke input saja
            supaya area mengetik di HP tidak terpotong baris tambahan. */}
        {/* Composer sejajar dengan kolom percakapan di layar lebar. */}
        <form
          onSubmit={submitText}
          className="relative mx-auto flex w-full max-w-3xl items-end gap-2"
        >
          {/* Dropdown saran @file (muncul di atas input saat token @ aktif).
              Wrapper rounded + overflow-hidden memotong scrollbar sesuai
              lengkungan, elemen di dalamnya yang men-scroll (Req kartu rounded). */}
          {mention.mention !== null && (mention.suggestions.length > 0 || mention.loading) && (
            <div className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-md border bg-popover shadow-md">
              <div className="max-h-56 overflow-y-auto">
                {mention.loading && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Searching files…</div>
                )}
                {!mention.loading && mention.error && (
                  <div className="px-3 py-2 text-xs text-destructive">{mention.error}</div>
                )}
                {mention.suggestions.map((file, i) => (
                  <button
                    key={file}
                    type="button"
                    className={`block w-full truncate px-3 py-2 text-left font-mono text-xs ${
                      i === mention.highlighted ? "bg-accent text-accent-foreground" : ""
                    }`}
                    onMouseDown={(e) => {
                      // mousedown (bukan click) agar textarea tidak blur duluan.
                      e.preventDefault();
                      const next = mention.pick(i);
                      if (next !== null) applyPicked(next);
                    }}
                  >
                    {file}
                  </button>
                ))}
              </div>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              mention.onInputChange(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              );
              autoResize(e.target);
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
            /**
             * `min-h-11` di HP: tinggi 36px sebelumnya memotong placeholder
             * satu baris. `text-base` mencegah Safari iOS auto-zoom saat
             * fokus (terjadi di bawah 16px).
             */
            className="max-h-40 min-h-11 w-full flex-1 resize-none rounded-md border bg-transparent px-3 py-2.5 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 sm:py-2 sm:text-sm"
          />
          {/* Tombol setinggi textarea (44px di HP) agar sebaris rapi. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canInput}
            aria-label="Attach image"
            title="Attach image (PNG/JPEG/GIF/WebP, max 20 MiB)"
            className="size-11 sm:size-9"
          >
            <ImagePlusIcon data-icon="inline-start" />
          </Button>
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
          {generating ? (
            // Saat model merespon: tombol kirim berubah jadi tombol Stop
            // (hentikan balasan saja, Session tetap aktif ala opencode).
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={interrupt}
              disabled={wsStatus !== "connected"}
              aria-label="Stop response"
              title="Stop the model response"
              className="size-11 border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive sm:size-9"
            >
              <SquareIcon className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!canSubmit}
              aria-label="Kirim"
              className="size-11 sm:size-9"
            >
              {sending ? (
                <Spinner className="size-4" />
              ) : (
                <SendHorizontalIcon data-icon="inline-start" />
              )}
            </Button>
          )}
        </form>
        {/* Pratinjau gambar yang akan dilampirkan (bisa dihapus sebelum kirim). */}
        {pendingImages.length > 0 && (
          <div className="mx-auto mt-2 flex w-full max-w-3xl flex-wrap gap-1.5">
            {pendingImages.map((img) => (
              <div key={img.key} className="group relative">
                <img
                  src={img.previewUrl}
                  alt={img.file.name}
                  className="h-16 w-16 rounded-md border object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.key)}
                  aria-label={`Remove ${img.file.name}`}
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-background/90 p-0.5 text-foreground shadow-sm transition-opacity group-hover:opacity-100"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </footer>

      {/* Konfirmasi hapus Session dari menu aksi header */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation history on the opencode server will also be permanently deleted. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Deleting…
                </>
              ) : (
                "Delete permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
