/**
 * Session yang dibuat di luar KCG untuk folder Project ini dan belum
 * diimpor — Claude Code (Claude Desktop tab Code, `claude` CLI) dan OpenCode
 * (TUI / desktop opencode) — untuk tab "Other agents" di `SessionList`:
 * - `useExternalSessions`: muat daftar gabungan (terbaru dulu, tidak
 *   dikelompokkan per agent). Hanya agent yang aktif & terpasang yang
 *   ditanya. Dimuat ulang saat Project dibuka, lewat "Reload sessions", dan
 *   saat data berubah (mis. setelah impor -> barisnya hilang dari sini).
 * - Klik baris LANGSUNG mengimpor: riwayat disalin ke KCG dan pesan
 *   berikutnya melanjutkan percakapan yang sama. Session yang masih terbuka
 *   di Desktop/CLI (atau sedang membalas di OpenCode) ditandai dan
 *   dilanjutkan sebagai salinan — yang asli tetap milik aplikasi itu.
 * - `ExternalSessionRow` setenang `SessionRow`: logo agent + judul + satu
 *   subjudul redup (asal / "Open in …" · waktu).
 * - `ExternalErrorRow`: agent yang gagal dimuat, dengan Retry.
 */
import { ChevronRightIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { ActionRow } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_TYPE_LABELS } from "@/lib/agent-types";
import { errorText } from "@/lib/api";
import { onDataChanged } from "@/lib/data-events";
import {
  type ExternalSessionItem,
  type ExternalSessionsLoad,
  externalBusyLabel,
  externalSourceLabel,
  importExternalSession,
  listExternalSessions,
} from "@/lib/external-sessions";
import { formatRelativeTime } from "@/lib/project-overview";
import { cn } from "@/lib/utils";
import type { AgentType, Session } from "@/types";

/** id Session hanya unik per agent. */
export function externalRowKey(s: ExternalSessionItem): string {
  return `${s.agentType}:${s.id}`;
}

export interface UseExternalSessions {
  /** null = belum dimuat. */
  load: ExternalSessionsLoad | null;
  /** Kunci baris yang sedang diimpor (daftar dikunci). */
  pendingKey: string | null;
  reload: () => void;
  runImport: (session: ExternalSessionItem) => Promise<void>;
}

export function useExternalSessions({
  projectId,
  reloadKey,
  onImported,
}: {
  projectId: string;
  /** Naik setiap "Reload sessions" -> daftar dimuat ulang. */
  reloadKey: number;
  /** Dipanggil dengan Session KCG hasil impor. */
  onImported: (session: Session) => void;
}): UseExternalSessions {
  const [load, setLoad] = useState<ExternalSessionsLoad | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [loadSeq, setLoadSeq] = useState(0);
  const reload = useCallback(() => setLoadSeq((n) => n + 1), []);

  // Session di aplikasi lain terus bertambah dan status "sibuk" berubah, jadi
  // daftar dimuat ulang di tiap pemicu. Respons usang dibuang. Kegagalan per
  // agent sudah ditangkap `listExternalSessions` (jadi baris error).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey/loadSeq = pemicu muat ulang
  useEffect(() => {
    let stale = false;
    void listExternalSessions(projectId).then((next) => {
      if (!stale) setLoad(next);
    });
    return () => {
      stale = true;
    };
  }, [projectId, reloadKey, loadSeq]);

  useEffect(() => onDataChanged(reload), [reload]);

  const runImport = async (session: ExternalSessionItem) => {
    if (pendingKey !== null) return;
    setPendingKey(externalRowKey(session));
    try {
      const imported = await importExternalSession(projectId, session);
      toast.success(session.openElsewhere ? "Copy imported." : "Session imported.");
      onImported(imported);
    } catch (e) {
      toast.error(errorText(e, "Failed to import the session"));
    } finally {
      setPendingKey(null);
    }
  };

  return { load, pendingKey, reload, runImport };
}

export function ExternalErrorRow({
  agentType,
  message,
  onRetry,
}: {
  agentType: AgentType;
  message: string;
  onRetry: () => void;
}) {
  return (
    <ActionRow
      prefix={<TriangleAlertIcon className="size-[18px] text-destructive" aria-hidden />}
      title={`Couldn't load ${AGENT_TYPE_LABELS[agentType]} sessions`}
      subtitle={message}
      suffix={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" />
          Retry
        </Button>
      }
    />
  );
}

export function ExternalSessionRow({
  session: s,
  pending,
  disabled,
  onSelect,
}: {
  session: ExternalSessionItem;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const source = externalSourceLabel(s);
  const busy = externalBusyLabel(s);
  return (
    // AdwActionRow yang bisa diaktifkan, sama dengan `SessionRow`: ikon 18px,
    // judul + satu baris subjudul (asal · waktu), chevron. Prompt pertama
    // cukup di tooltip agar daftar tetap tenang.
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={s.firstPrompt && s.firstPrompt !== s.title ? s.firstPrompt : s.title}
      aria-label={`Continue ${s.title} from ${source}${s.openElsewhere ? `, ${busy.charAt(0).toLowerCase()}${busy.slice(1)}, continues as a copy` : ""}`}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors outline-none",
        "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset active:bg-muted",
        disabled && !pending && "opacity-60",
      )}
    >
      <AgentLogo agentType={s.agentType} className="size-[18px] text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
        <span className="truncate text-[15px] leading-5">{s.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-muted-foreground">
          {/* Redup seperti subjudul lain: di tab ini hampir semua Session
              Desktop "terbuka", jadi warna justru menambah ramai. */}
          <span className="truncate">{s.openElsewhere ? busy : source}</span>
          <span className="opacity-50" aria-hidden>
            ·
          </span>
          <span className="shrink-0 tabular-nums">{formatRelativeTime(s.updatedAt)}</span>
        </span>
      </span>
      {pending ? (
        <Spinner className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}
