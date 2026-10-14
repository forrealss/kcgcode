/**
 * Pemilih permission mode untuk agent yang memilikinya (capability
 * `permissionModes`, mis. Claude Code) — padanan Shift+Tab di Claude Code CLI.
 *
 * - Daftar mode berasal dari agent (`usePermissionModes`), bukan hardcode UI.
 * - Pergantian berlaku SEGERA, juga saat agent sedang menjawab (mis. pindah
 *   ke Plan ketika agent mulai mengedit).
 * - Mode berisiko (`dangerous`, mis. Bypass permissions) wajib dikonfirmasi.
 * - Mode aktif ikut berubah bila agent sendiri berganti mode (mis. rencana
 *   disetujui) — disinkronkan lewat WS `session_permission_mode`.
 *
 * `PermissionModeList` dipakai di popover desktop (`PermissionModePicker`)
 * maupun langsung di Sheet aksi mobile.
 */
import {
  BanIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  ListTreeIcon,
  type LucideIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { ModeRow } from "@/components/sessions/AgentModeList";
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
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { UsePermissionModesResult } from "@/hooks/usePermissionModes";
import { cn } from "@/lib/utils";
import type { PermissionModeOption } from "@/types";

/** Ikon per mode (id Claude Code); mode tak dikenal -> perisai polos. */
export function permissionModeIcon(id: string | null): LucideIcon {
  switch (id) {
    case "default":
      return ShieldCheckIcon;
    case "acceptEdits":
      return FilePenLineIcon;
    case "plan":
      return ListTreeIcon;
    case "auto":
      return SparklesIcon;
    case "dontAsk":
      return BanIcon;
    case "bypassPermissions":
      return ShieldOffIcon;
    default:
      return ShieldIcon;
  }
}

/** Label mode aktif (null = default settings agent). */
export function permissionModeLabel(modes: PermissionModeOption[], id: string | null): string {
  if (id === null) return "Default";
  return modes.find((m) => m.id === id)?.label ?? id;
}

export interface PermissionModeListProps {
  modes: PermissionModeOption[];
  /** Mode aktif; null = default settings agent. */
  active: string | null;
  saving?: boolean;
  disabled?: boolean;
  error?: string | null;
  onPick: (mode: string | null) => void;
  variant?: "popover" | "sheet";
}

export function PermissionModeList({
  modes,
  active,
  saving = false,
  disabled = false,
  error = null,
  onPick,
  variant = "popover",
}: PermissionModeListProps) {
  /** Mode berisiko yang menunggu konfirmasi. */
  const [confirming, setConfirming] = useState<PermissionModeOption | null>(null);
  const sheet = variant === "sheet";
  const off = disabled || saving;

  return (
    <div className="flex flex-col gap-0.5">
      <ModeRow
        icon={ShieldIcon}
        label="Default"
        description="Follow your agent permission settings"
        selected={active === null}
        onClick={() => onPick(null)}
        sheet={sheet}
        disabled={off}
      />
      {modes.map((m) => (
        <ModeRow
          key={m.id}
          icon={permissionModeIcon(m.id)}
          label={m.label}
          description={m.description}
          selected={m.id === active}
          accent={m.id === "plan"}
          danger={m.dangerous}
          onClick={() => (m.dangerous && m.id !== active ? setConfirming(m) : onPick(m.id))}
          sheet={sheet}
          disabled={off}
        />
      ))}
      {error && <div className="px-3 py-2 text-sm text-destructive">{error}</div>}

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to “{confirming?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.description}. The agent will run tools — including shell commands and
              file edits — without asking you first. Only use this in a disposable or sandboxed
              project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirming) onPick(confirming.id);
                setConfirming(null);
              }}
            >
              Switch mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export interface PermissionModePickerProps {
  picker: UsePermissionModesResult;
  /** Mode aktif; null = default settings agent. */
  active: string | null;
  disabled?: boolean;
  className?: string;
}

/** Trigger + popover pemilih permission mode (toolbar composer desktop). */
export function PermissionModePicker({
  picker,
  active,
  disabled = false,
  className,
}: PermissionModePickerProps) {
  const [open, setOpen] = useState(false);
  const modes = picker.modes ?? [];
  const current = modes.find((m) => m.id === active);
  const Icon = permissionModeIcon(active);
  const label = permissionModeLabel(modes, active);
  const isPlan = active === "plan";
  const isDanger = current?.dangerous === true;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Permission mode: ${label}`}
          title="Change permission mode"
          className={cn(
            "group h-8 shrink-0 gap-1.5 rounded-full border border-transparent px-2.5 text-[13px] font-medium text-muted-foreground",
            "hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
            isPlan &&
              "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400",
            isDanger &&
              "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
            className,
          )}
        >
          {picker.saving ? <Spinner className="size-4" /> : <Icon className="size-3.5" />}
          <span className="inline max-w-24 truncate sm:max-w-32">{label}</span>
          <ChevronDownIcon
            className="size-3.5 opacity-60 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 flex-col overflow-hidden p-0"
      >
        <div className="shrink-0 border-b px-3 pt-2.5 pb-2">
          <p className="text-sm font-medium">Permission mode</p>
          <p className="text-xs text-muted-foreground">Takes effect right away, even mid-reply</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]">
          <PermissionModeList
            modes={modes}
            active={active}
            saving={picker.saving}
            disabled={disabled}
            error={picker.error}
            onPick={(mode) => {
              void picker.pick(mode);
              setOpen(false);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
