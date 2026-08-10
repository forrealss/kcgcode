/**
 * Tampilan Session (Requirement 5.1, 5.2, 6.1, 6.2, 7.1, 8.3).
 *
 * Konsumen `use-websocket.ts`:
 * - `history` (reattach) & `output` dirender sebagai daftar pesan; tiap pesan
 *   memiliki collapsible thinking block dengan state `Record<messageId, boolean>`
 *   default expanded (Requirement 8.3) — logika murni di `collapsible-state.ts`
 *   (Property 25).
 * - `prompt` dirender lewat `prompt-card.tsx`; `prompt_resolved` menghapusnya.
 * - `session_status` memperbarui badge status; `error` ditampilkan.
 * - Input field bebas mengirim `{ type: "input" }` (Requirement 7.1).
 * - `resize` dikirim sekali saat mount agar PTY menyesuaikan viewport.
 */

import { ChevronLeftIcon, ChevronRightIcon, SendHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { useWebSocket, type WsConnectionStatus } from "@/hooks/use-websocket";
import { getAuthToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { OutputChunk, PromptResponse, Session, SessionStatus } from "@/server/types";
import type { ServerMessage } from "@/server/ws-protocol";
import {
  type CollapsibleState,
  initialCollapsibleState,
  isCollapsibleExpanded,
  toggleCollapsible,
} from "./collapsible-state";
import { PromptCard } from "./prompt-card";

export interface SessionViewProps {
  session: Session;
  onBack: () => void;
}

type ViewMessage = Omit<OutputChunk, "sessionId">;

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

export function SessionView({ session, onBack }: SessionViewProps) {
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [collapsible, setCollapsible] = useState<CollapsibleState>({});
  const [prompts, setPrompts] = useState<Extract<ServerMessage, { type: "prompt" }>["prompt"][]>(
    [],
  );
  const [status, setStatus] = useState<SessionStatus>(session.status);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");

  const onMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "history":
        setError(null);
        setMessages(msg.chunks.map((c) => ({ seq: c.seq, data: c.data, ts: c.ts })));
        setCollapsible(initialCollapsibleState(msg.chunks.map((c) => String(c.seq))));
        break;
      case "output":
        setError(null);
        setMessages((prev) =>
          prev.some((m) => m.seq === msg.seq)
            ? prev
            : [...prev, { seq: msg.seq, data: msg.data, ts: msg.ts }],
        );
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
        break;
      case "error":
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

  // Attach per mount (perubahan session => remount via key di App). Tanpa
  // guard ref: React 19 StrictMode me-double-invoke efek (effect -> cleanup
  // -> effect), dan `attach()` idempoten — server mengirim ulang `history`
  // yang *replace* state, sehingga aman dipanggil dua kali.
  useEffect(() => {
    attach(session.id);
    return () => disconnect();
  }, [attach, disconnect, session.id]);

  // Kirim resize awal agar PTY menyesuaikan viewport (Requirement 5.1).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cols = Math.max(40, Math.min(200, Math.floor(window.innerWidth / 8)));
    send({ type: "resize", sessionId: session.id, cols, rows: 24 });
  }, [send, session.id]);

  const resolvePrompt = useCallback(
    (promptId: string, response: PromptResponse) => {
      send({ type: "prompt_response", sessionId: session.id, promptId, response });
    },
    [send, session.id],
  );

  const submitText = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === "") return;
    send({ type: "input", sessionId: session.id, text });
    setText("");
  };

  const canInput = wsStatus === "connected" && status === "running";

  const toggleMessage = (messageId: string) => {
    setCollapsible((s) => toggleCollapsible(s, messageId));
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
          <Badge variant={wsStatus === "connected" ? "default" : "secondary"}>
            {wsStatusLabel(wsStatus)}
          </Badge>
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </div>
      </header>

      {/* Output_Stream */}
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
                    Menunggu output CLI_Agent…
                  </p>
                </MessageScrollerItem>
              ) : (
                messages.map((m) => {
                  const id = String(m.seq);
                  const expanded = isCollapsibleExpanded(collapsible, id);
                  return (
                    <MessageScrollerItem key={id} messageId={id}>
                      <Message align="start">
                        <MessageContent>
                          <MessageHeader>#{m.seq}</MessageHeader>
                          <Collapsible open={expanded}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                              onClick={() => toggleMessage(id)}
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
                                  <BubbleContent className="font-mono whitespace-pre-wrap">
                                    {m.data}
                                  </BubbleContent>
                                </Bubble>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                          <MessageFooter>{formatTime(m.ts)}</MessageFooter>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  );
                })
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

      {/* Input bebas (Requirement 7.1) */}
      <footer className="border-t px-3 py-2">
        <form onSubmit={submitText} className="flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={canInput ? "Ketik pesan ke CLI_Agent…" : "Session tidak aktif"}
            aria-label="Input bebas"
            disabled={!canInput}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canInput || text.trim() === ""}
            aria-label="Kirim"
          >
            <SendHorizontalIcon data-icon="inline-start" />
          </Button>
        </form>
      </footer>
    </div>
  );
}
