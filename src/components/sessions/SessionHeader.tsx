/**
 * Header chat ala aplikasi chat mobile: back — nama model (pembuka picker) —
 * aksi. Nama model jadi judul karena itulah informasi yang paling sering
 * dilihat & diganti; identitas Session (agentType + id) turun ke baris kedua
 * yang hanya tampil di layar lebar.
 *
 * Tiga tombol saja di HP supaya lega: back, play/stop, dan menu aksi.
 */
import {
  ChevronLeftIcon,
  MoonIcon,
  MoreVerticalIcon,
  PlayIcon,
  SquareIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { ModelPicker } from "@/components/sessions/ModelPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/hooks/useTheme";
import type { WsConnectionStatus } from "@/hooks/useWebSocket";
import { SESSION_STATUS_DOT, sessionStatusVariant, wsStatusLabel } from "@/lib/session-status";
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
  onBack: () => void;
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
  onBack,
  stopping,
  starting,
}: SessionHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  /** Model pilihan Session — dapat diganti live; null = default opencode. */
  const [model, setModel] = useState<SessionModel | null>(session.model);

  return (
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
            onClick={onStop}
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
            onClick={onStart}
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
          <span className={cn("size-2 rounded-full", SESSION_STATUS_DOT[status])} aria-hidden />
          <span className="sr-only">Session {status}</span>
        </span>
        <Badge variant={sessionStatusVariant(status)} className="hidden shrink-0 sm:inline-flex">
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
