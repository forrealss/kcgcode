/**
 * Pemilih agent (mode) opencode untuk composer Session — padanan tombol
 * ganti mode build/plan di TUI opencode (Tab).
 *
 * - Trigger: tombol kecil di toolbar BAWAH input prompt (ala aplikasi chat);
 *   menampilkan nama agent aktif + ikon. `plan` ditandai khusus (ikon +
 *   warna berbeda) supaya user sadar sedang "mode aman".
 * - Daftar agent dari `GET /api/projects/:id/agents` (dimuat saat popover
 *   pertama dibuka — server headless tidak di-spawn kalau tidak dipakai).
 * - Perubahan via `PUT /api/sessions/:id` (`agent`), berlaku di prompt
 *   berikutnya tanpa restart. Opsi "Default" mengirim `agent: null`.
 *
 * Fetch + pick logic ada di `useAgentPicker` dan daftar opsi di
 * `AgentModeList` — keduanya dipakai ulang langsung (tanpa popover) di Sheet
 * aksi mobile (`SessionView`).
 */
import { ChevronDownIcon, CompassIcon, HammerIcon, ListTreeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentModeList } from "@/components/sessions/AgentModeList";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useAgentPicker } from "@/hooks/useAgentPicker";
import { cn } from "@/lib/utils";

export interface AgentPickerProps {
  projectId: string;
  /** null = Session belum ada (composer homepage): pilihan tidak di-PUT. */
  sessionId: string | null;
  /** Agent aktif saat ini; null = default opencode (build). */
  agent: string | null;
  /** Dipanggil setelah server menerima perubahan agent. */
  onChanged: (agent: string | null) => void;
  /** Nonaktifkan picker (mis. Session tidak running / WS sibuk). */
  disabled?: boolean;
  /** Override tampilan trigger, mis. `w-full justify-start` saat ditaruh di dalam Sheet aksi mobile. */
  className?: string;
}

export function AgentPicker({
  projectId,
  sessionId,
  agent,
  onChanged,
  disabled = false,
  className,
}: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const { agents, loading, saving, error, load, pick } = useAgentPicker(
    projectId,
    sessionId,
    (name) => {
      onChanged(name);
      setOpen(false);
    },
  );

  const isPlan = agent?.toLowerCase() === "plan";
  const label = agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : "Default";
  const ActiveIcon = isPlan
    ? ListTreeIcon
    : agent?.toLowerCase() === "build"
      ? HammerIcon
      : CompassIcon;

  // Daftar dimuat saat popover pertama dibuka (lazy, ala ModelPicker).
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Popover open={open} onOpenChange={(o) => setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Agent mode: ${label}`}
          title="Change mode"
          className={cn(
            "group h-8 shrink-0 gap-1.5 rounded-full border border-transparent px-2.5 text-[13px] font-medium text-muted-foreground",
            "hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
            isPlan &&
              "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 hover:text-amber-700 data-[state=open]:bg-amber-500/15 data-[state=open]:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400 dark:data-[state=open]:text-amber-400",
            className,
          )}
        >
          {saving ? <Spinner className="size-4" /> : <ActiveIcon className="size-3.5" />}
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
        className="w-80 p-0"
      >
        <div className="border-b px-3 pt-2.5 pb-2">
          <p className="text-sm font-medium">Mode</p>
          <p className="text-xs text-muted-foreground">How the agent handles your next message</p>
        </div>
        {/* Tinggi menyesuaikan ruang di atas trigger (Radix), dibatasi 22rem. */}
        <div className="max-h-[min(22rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]">
          <AgentModeList
            agents={agents}
            loading={loading}
            error={error}
            activeAgent={agent}
            saving={saving}
            disabled={disabled}
            onPick={(name) => void pick(name)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
