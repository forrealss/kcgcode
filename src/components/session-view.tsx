/**
 * Tampilan Session — versi headless (opencode serve).
 *
 * Berbeda dari versi PTY/TUI (yang me-render chunk byte terminal TUI):
 * - Pesan datang sebagai `SessionMessage` terstruktur (`role` + `parts`):
 *   text, reasoning (collapsible per part), tool/step.
 * - Interactive_Prompt (permission/question) dirender via `prompt-card.tsx`.
 * - Saat model merespon (`turn_active` true / pesan streaming) tombol kirim
 *   berubah jadi tombol Stop (kirim `{ type: "interrupt" }`) — menghentikan
 *   balasan saja ala opencode, Session tetap berjalan. `{ type: "stop" }`
 *   (menonaktifkan Session) tetap ada lewat daftar Session / HTTP.
 *
 * Konsumen `use-websocket.ts`:
 * - `history` (reattach) berisi `messages` + `prompts` pending.
 * - `message` menambah pesan baru; `prompt`/`prompt_resolved` mengelola kartu.
 * - `session_status` memperbarui badge; `turn_active` status model merespon;
 *   `error` ditampilkan.
 */
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  FileIcon,
  ImagePlusIcon,
  PlayIcon,
  SendHorizontalIcon,
  SquareIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { useFileMention } from "@/hooks/use-mention";
import { useWebSocket, type WsConnectionStatus } from "@/hooks/use-websocket";
import {
  ApiError,
  apiErrorMessage,
  apiFetch,
  apiUploadImage,
  attachmentUrl,
  getAuthToken,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  InteractivePrompt,
  MessagePart,
  PromptResponse,
  Session,
  SessionMessage,
  SessionModel,
  SessionStatus,
} from "@/server/types";
import type { ServerMessage } from "@/server/ws-protocol";
import {
  type CollapsibleState,
  extendCollapsed,
  initialCollapsedState,
  isCollapsibleExpanded,
  toggleCollapsible,
} from "./collapsible-state";
import { PromptCard } from "./prompt-card";
import { TypewriterText } from "./typewriter-text";

export interface SessionViewProps {
  session: Session;
  onBack: () => void;
}

function wsStatusLabel(status: WsConnectionStatus): string {
  switch (status) {
    case "connected":
      return "terhubung";
    case "connecting":
      return "menghubungkan…";
    case "reconnecting":
      return "menyambung ulang…";
    default:
      return "terputus";
  }
}

function statusVariant(status: SessionStatus): "default" | "secondary" | "destructive" {
  if (status === "running") return "default";
  if (status === "crashed") return "destructive";
  return "secondary";
}

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

/**
 * Deteksi pertumbuhan teks part yang di-stream LIVE (SSE `message_part`).
 * - `prevLen > 0`: part sudah pernah tampil (bukan kemunculan pertama, yang
 *   sering kali kosong / snapshot awal).
 * - `newLen > prevLen`: teks bertambah -> provider benar-benar men-stream
 *   token bertahap. Bila true, pesan ditandai "live" dan tidak perlu efek
 *   typewriter (teks sudah tampil bertambah di layar).
 */
export function isLiveTextGrowth(prevLen: number, newLen: number): boolean {
  return prevLen > 0 && newLen > prevLen;
}

/**
 * Keputusan efek mengetik untuk satu pesan assistant (murni, diuji):
 * - `typingIds` berisi id pesan final yang baru tiba (kandidat typewriter).
 * - `liveTextIds` berisi id pesan yang teksnya ter-stream live bertahap —
 *   pesan ini TIDAK boleh di-typewrite (teks sudah tampil apa adanya).
 */
export function shouldTypewrite(
  messageId: string,
  typingIds: ReadonlySet<string>,
  liveTextIds: ReadonlySet<string>,
): boolean {
  return typingIds.has(messageId) && !liveTextIds.has(messageId);
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

export function SessionView({ session, onBack }: SessionViewProps) {
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
  /**
   * Id pesan assistant final yang baru tiba -> kandidat efek mengetik.
   * Hanya fallback: bila teks sudah ter-stream live, pesan dirender penuh.
   */
  const [typingIds, setTypingIds] = useState<Set<string>>(new Set());
  /** Id pesan yang teksnya ter-stream LIVE (bertambah bertahap) — tanpa typewriter. */
  const [liveTextIds, setLiveTextIds] = useState<Set<string>>(new Set());
  /** Panjang teks part terakhir (key `${messageId}:${partId}`) untuk deteksi growth. */
  const partLenRef = useRef<Map<string, number>>(new Map());

  const onMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "history":
        setError(null);
        setMessages(msg.messages);
        setPrompts(msg.prompts);
        // Pesan lama tampil penuh tanpa efek mengetik; reset status live & turn.
        setTypingIds(new Set());
        setLiveTextIds(new Set());
        setTurnActive(false);
        partLenRef.current.clear();
        // Reasoning tampil collapsed (baris "Thinking"), bisa di-expand per part.
        // Key berbasis part.id agar stabil walau parts bertambah saat streaming.
        setCollapsible(
          initialCollapsedState(
            msg.messages.flatMap((m) =>
              m.parts
                .map((p, i) => (p.type === "reasoning" ? `${m.id}:${p.id ?? i}` : null))
                .filter((k): k is string => k !== null),
            ),
          ),
        );
        break;
      case "message":
        setError(null);
        // Replace versi streaming (id sama) atau tambahkan pesan baru.
        setMessages((prev) => upsertMessage(prev, msg.message));
        // Pesan assistant final yang baru tiba -> efek mengetik dari kosong.
        if (msg.message.role === "assistant") {
          setTypingIds((prev) => new Set(prev).add(msg.message.id));
        }
        // Reasoning final juga default collapsed (extendCollapsed tidak mengubah
        // status key yang sudah ada, termasuk yang sudah di-toggle user).
        setCollapsible((prev) =>
          extendCollapsed(
            prev,
            msg.message.parts
              .map((p, i) => (p.type === "reasoning" ? `${msg.message.id}:${p.id ?? i}` : null))
              .filter((k): k is string => k !== null),
          ),
        );
        break;
      case "message_part":
        setError(null);
        setMessages((prev) => upsertMessagePart(prev, msg.sessionId, msg.messageId, msg.part));
        // Part text yang bertambah bertahap (provider streaming asli) -> tandai
        // live agar pesan final tidak memulai ulang efek mengetik atas teks yang
        // sudah tampil. Kemunculan pertama (biasanya kosong) tidak dihitung.
        if (msg.part.type === "text" && msg.part.id !== undefined) {
          const key = `${msg.messageId}:${msg.part.id}`;
          const prevLen = partLenRef.current.get(key) ?? 0;
          const newLen = typeof msg.part.text === "string" ? msg.part.text.length : 0;
          if (isLiveTextGrowth(prevLen, newLen)) {
            setLiveTextIds((prev) => new Set(prev).add(msg.messageId));
          }
          partLenRef.current.set(key, newLen);
        }
        // Reasoning yang baru mulai di-stream: default collapsed.
        if (msg.part.type === "reasoning" && msg.part.id !== undefined) {
          setCollapsible((prev) => extendCollapsed(prev, [`${msg.messageId}:${msg.part.id}`]));
        }
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
        setError(`"${file.name}" bukan gambar.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" melebihi batas 20 MiB.`);
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

  /** Hentikan balasan model (interrupt ala opencode) — Session tetap aktif. */
  const interrupt = () => {
    send({ type: "interrupt", sessionId: session.id });
  };

  /** Resume via API langsung — hasil status baru tiba via WS `session_status`. */
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStarting(true);
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "POST" });
      // Status baru dikirim gateway ke semua subscriber; tak perlu setState di sini.
    } catch {
      // Kegagalan dibiarkan: badge status tidak berubah, user bisa coba lagi.
    } finally {
      setStarting(false);
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

  const toggleMessage = (key: string) => {
    setCollapsible((s) => toggleCollapsible(s, key));
  };

  const renderAssistantMessage = (m: SessionMessage) => {
    const reasoning = m.parts
      .map((p, i) => ({ part: p, index: i }))
      .filter(({ part }) => part.type === "reasoning");
    const tools = m.parts.filter(
      (p) => p.type === "tool" || p.type === "shell" || p.type === "file",
    );
    // Part `type: "error"` (pesan gagal turn dari session-manager) dirender
    // sebagai bubble destructive — beda dari balasan normal.
    const errors = m.parts.filter((p) => p.type === "error");
    const body = textOf(m.parts);

    return (
      <Message key={m.id} align="start">
        <MessageContent>
          <MessageHeader className="gap-1.5">
            <BotIcon className="size-3.5" data-icon="inline-start" />
            OpenCode
          </MessageHeader>
          {reasoning.map(({ part, index }) => {
            const key = `${m.id}:${part.id ?? index}`;
            const expanded = isCollapsibleExpanded(collapsible, key);
            return (
              <Collapsible key={key} open={expanded}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={() => toggleMessage(key)}
                  aria-expanded={expanded}
                >
                  <ChevronRightIcon
                    data-icon="inline-start"
                    className={cn("transition-transform", expanded && "rotate-90")}
                  />
                  Thinking
                </Button>
                <CollapsibleContent>
                  <div className="pt-1.5">
                    <Bubble variant="outline">
                      {/* Tinggi konten dibatasi + scroll internal agar reasoning
                          panjang tidak memenuhi layar (tetap bisa di-expand). */}
                      <BubbleContent className="font-mono whitespace-pre-wrap">
                        <div className="max-h-64 overflow-y-auto">{partText(part)}</div>
                      </BubbleContent>
                    </Bubble>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
          {body !== "" && (
            <Bubble variant="secondary">
              <BubbleContent>
                <TypewriterText
                  text={body}
                  // Efek mengetik hanya fallback: teks yang sudah ter-stream
                  // live (bertambah bertahap) dirender penuh apa adanya.
                  active={shouldTypewrite(m.id, typingIds, liveTextIds)}
                  className="whitespace-pre-wrap"
                />
              </BubbleContent>
            </Bubble>
          )}
          {errors.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {errors.map((p) => (
                <Bubble key={p.id ?? `${m.id}-err`} variant="destructive">
                  <BubbleContent>
                    <div className="flex gap-2">
                      <CircleAlertIcon
                        className="mt-0.5 size-4 shrink-0"
                        data-icon="inline-start"
                      />
                      <span className="whitespace-pre-wrap">
                        {partText(p) ?? "Terjadi kesalahan saat memproses prompt."}
                      </span>
                    </div>
                  </BubbleContent>
                </Bubble>
              ))}
            </div>
          )}
          {m.streaming && (
            <span className="animate-pulse px-3 text-xs text-muted-foreground">
              sedang mengetik…
            </span>
          )}
          {tools.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3">
              {tools.map((p) => (
                <Badge
                  key={p.id ?? `${m.id}-${p.tool ?? p.type}`}
                  variant="outline"
                  className="gap-1 font-mono text-[11px]"
                >
                  <WrenchIcon className="size-3" data-icon="inline-start" />
                  {p.tool ?? p.type}
                </Badge>
              ))}
            </div>
          )}
          <MessageFooter>{formatTime(m.createdAt)}</MessageFooter>
        </MessageContent>
      </Message>
    );
  };

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
                    alt={p.filename ?? "gambar lampiran"}
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
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Kembali">
            <ChevronLeftIcon data-icon="inline-start" />
          </Button>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{session.agentType}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {session.id.slice(0, 8)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Session non-running: tombol hidupkan kembali. Saat running, stop
              balasan model ada di composer (berubah jadi tombol Stop). */}
          {status !== "running" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={start}
              disabled={starting}
              aria-label="Hidupkan kembali"
            >
              {starting ? <Spinner className="size-3.5" /> : <PlayIcon data-icon="inline-start" />}
              Start
            </Button>
          )}
          <Badge variant={wsStatus === "connected" ? "default" : "secondary"}>
            {wsStatusLabel(wsStatus)}
          </Badge>
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </div>
      </header>

      {/* Percakapan terstruktur */}
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent>
              {error && (
                <MessageScrollerItem messageId="error">
                  <p className="px-3 text-sm text-destructive">{error}</p>
                </MessageScrollerItem>
              )}
              {messages.length === 0 && prompts.length === 0 ? (
                <MessageScrollerItem messageId="empty">
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Belum ada percakapan. Kirim pesan pertama untuk mulai.
                  </p>
                </MessageScrollerItem>
              ) : (
                messages.map((m) =>
                  m.role === "user" ? renderUserMessage(m) : renderAssistantMessage(m),
                )
              )}
              {prompts.map((prompt) => (
                <MessageScrollerItem key={prompt.id} messageId={prompt.id}>
                  <PromptCard prompt={prompt} onResolve={(r) => resolvePrompt(prompt.id, r)} />
                </MessageScrollerItem>
              ))}
              {status !== "running" && messages.length > 0 && (
                <MessageScrollerItem messageId="status-note">
                  <p className="px-3 text-xs text-muted-foreground">
                    Session {status}. Input dinonaktifkan.
                  </p>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {/* Input bebas */}
      <footer className="border-t px-3 py-2">
        <div className="mb-2">
          <ModelPicker
            projectId={session.projectId}
            sessionId={session.id}
            model={model}
            onChanged={setModel}
          />
        </div>
        <form onSubmit={submitText} className="relative flex items-end gap-2">
          {/* Dropdown saran @file (muncul di atas input saat token @ aktif).
              Wrapper rounded + overflow-hidden memotong scrollbar sesuai
              lengkungan, elemen di dalamnya yang men-scroll (Req kartu rounded). */}
          {mention.mention !== null && (mention.suggestions.length > 0 || mention.loading) && (
            <div className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-md border bg-popover shadow-md">
              <div className="max-h-56 overflow-y-auto">
                {mention.loading && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Mencari file…</div>
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
            placeholder={
              busy
                ? "Model sedang merespon…"
                : canInput
                  ? "Ketik pesan… ketik @ untuk referensi file, atau tempel gambar"
                  : "Session tidak aktif"
            }
            aria-label="Input bebas"
            disabled={!canInput}
            rows={1}
            className="max-h-40 min-h-9 w-full flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canInput}
            aria-label="Lampirkan gambar"
            title="Lampirkan gambar (PNG/JPEG/GIF/WebP, maks 20 MiB)"
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
              aria-label="Hentikan balasan"
              title="Hentikan balasan model"
              className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <SquareIcon className="size-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!canSubmit} aria-label="Kirim">
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
          <div className="mt-2 flex flex-wrap gap-1.5">
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
                  aria-label={`Hapus ${img.file.name}`}
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-background/90 p-0.5 text-foreground shadow-sm transition-opacity group-hover:opacity-100"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}
