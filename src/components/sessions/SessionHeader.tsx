/**
 * Header chat ala aplikasi chat mobile: toggle sidebar — nama model (pembuka
 * picker) — aksi. Nama model jadi judul karena itulah informasi yang paling
 * sering dilihat & diganti; identitas Session (agentType + id) turun ke baris
 * kedua yang hanya tampil di layar lebar.
 *
 * Tanpa tombol back: navigasi antar Session/Project lewat sidebar.
 */
import {
  MoonIcon,
  MoreVerticalIcon,
  PlayIcon,
  SquareIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { ModelPicker } from "@/components/sessions/ModelPicker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/hooks/useTheme";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import { SESSION_STATUS_DOT, SESSION_STATUS_LABEL, wsStatusLabel } from "@/lib/session-status";
import { cn } from "@/lib/utils";
import type { Session, SessionModel, SessionStatus } from "@/types";

export interface SessionHeaderProps {
  session: Session;
  status: SessionStatus;
  wsStatus: WsConnectionStatus;
  /** Aksi stop Session (engine) — status baru tiba via WS `session_status`. */
  onStop: () => void;
  /** Aksi start/resume Session (engine). */
  onStart: () => void;
  /** Buka dialog konfirmasi hapus Session (dirender di SessionView). */
  onRequestDelete: () => void;
  stopping: boolean;
  starting: boolean;
}

export function SessionHeader({
  session,
  status,
  wsStatus,
  onStop,
  onStart,
  onRequestDelete,
  stopping,
  starting,
}: SessionHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  /** Model pilihan Session — dapat diganti live; null = default opencode. */
  const [model, setModel] = useState<SessionModel | null>(session.model);

  return (
    <header className="shrink-0">
      {/* Tanpa border — sidebar sudah jadi pembatas. Lebar penuh (bukan kolom
          percakapan) agar toggle sidebar menempel di tepi kiri, sama seperti
          header shell di halaman lain. Navigasi kembali lewat sidebar. */}
      <div className="flex w-full items-center gap-1 px-3 py-3 sm:gap-2 sm:px-4">
        {/* Buka/ciutkan sidebar Session (Sheet di HP). */}
        <SidebarTrigger className="size-9 shrink-0" />

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

        {/* Status = teks biasa + titik (bukan pil yang terlihat seperti
          tombol). Di HP cukup titiknya; label teks mulai dari sm. */}
        <span
          role="status"
          className="flex shrink-0 items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground"
          title={`Session ${SESSION_STATUS_LABEL[status].toLowerCase()}`}
        >
          <span className="relative flex size-2" aria-hidden>
            {status === "running" && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 motion-reduce:hidden" />
            )}
            <span
              className={cn("relative inline-flex size-2 rounded-full", SESSION_STATUS_DOT[status])}
            />
          </span>
          <span className="sr-only sm:not-sr-only">{SESSION_STATUS_LABEL[status]}</span>
        </span>

        {/* Stop/Start berlabel teks agar jelas fungsinya (bukan ikon kotak
          tanpa arti). Di HP label disembunyikan, tapi tombol tetap punya
          aria-label & ukuran sentuh 40px. Saat model sedang merespon,
          penghentian balasan ada di composer. */}
        {status === "running" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStop}
            disabled={stopping}
            aria-label="Stop session"
            className="relative size-8 shrink-0 rounded-full px-0 after:absolute after:-inset-1 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive sm:h-8 sm:w-auto sm:px-3 sm:after:hidden dark:hover:bg-destructive/15"
          >
            {stopping ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SquareIcon data-icon="inline-start" className="size-3.5 fill-current" />
            )}
            <span className="hidden sm:inline">{stopping ? "Stopping…" : "Stop"}</span>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onStart}
            disabled={starting}
            aria-label={status === "crashed" ? "Restart session" : "Start session"}
            className="relative size-8 shrink-0 rounded-full px-0 after:absolute after:-inset-1 sm:h-8 sm:w-auto sm:px-3 sm:after:hidden"
          >
            {starting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" className="size-3.5 fill-current" />
            )}
            <span className="hidden sm:inline">
              {starting ? "Starting…" : status === "crashed" ? "Restart" : "Start"}
            </span>
          </Button>
        )}

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
            <DropdownMenuItem variant="destructive" onSelect={onRequestDelete}>
              <Trash2Icon />
              Delete session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
