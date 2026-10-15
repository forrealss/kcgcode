/** Tombol & baris bersama grup panel samping Project (MCP, Skills). */
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionRow } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type AgentFailure, describeFailedAgents } from "@/lib/agent-lists";

/** Tombol datar bundar di kanan judul grup (aksi header AdwPreferencesGroup). */
export function FlatIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="size-8 rounded-full text-foreground/80"
    >
      {children}
    </Button>
  );
}

/** Baris placeholder saat memuat — tinggi sama dengan ActionRow. */
export function SkeletonRows({ rows }: { rows: number }) {
  return Array.from({ length: rows }, (_, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: placeholder statis
    <li key={i} className="flex min-h-14 flex-col justify-center gap-1.5 px-4 py-2.5" aria-hidden>
      <Skeleton className="h-4" style={{ width: `${60 - i * 12}%` }} />
      <Skeleton className="h-3 w-1/3" />
    </li>
  ));
}

/** Baris error dengan tombol coba lagi. */
export function ErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <ActionRow
      prefix={<TriangleAlertIcon className="size-[18px] text-destructive" aria-hidden />}
      title="Couldn't load"
      subtitle={message}
      suffix={
        onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}

/** Baris catatan bila sebagian agent gagal dibaca. */
export function PartialFailureRow({ failed }: { failed: readonly AgentFailure[] }) {
  if (failed.length === 0) return null;
  return (
    <ActionRow
      prefix={
        <TriangleAlertIcon className="size-[18px] text-amber-600 dark:text-amber-400" aria-hidden />
      }
      title={describeFailedAgents(failed)}
      subtitle={failed[0]?.message}
    />
  );
}
