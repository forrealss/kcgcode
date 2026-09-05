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
import { CompassIcon, ListTreeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentModeList } from "@/components/sessions/AgentModeList";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useAgentPicker } from "@/hooks/useAgentPicker";
import { cn } from "@/lib/utils";

export interface AgentPickerProps {
  projectId: string;
  sessionId: string;
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
  const label = agent ?? "Default";
  const ActiveIcon = isPlan ? ListTreeIcon : CompassIcon;

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
          title={`Agent mode: ${label} — click to switch`}
          className={cn(
            "h-9 shrink-0 gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground",
            "hover:bg-muted hover:text-foreground sm:h-9",
            isPlan && "text-amber-500 hover:text-amber-500",
            className,
          )}
        >
          {saving ? (
            <Spinner className="size-4" />
          ) : (
            <ActiveIcon className={cn("size-4", isPlan && "text-amber-500")} />
          )}
          <span className="inline max-w-24 truncate sm:max-w-32">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Agent mode</p>
        <div className="max-h-64 overflow-y-auto">
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
