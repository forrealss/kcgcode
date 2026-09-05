/**
 * Daftar model dengan pencarian — komponen presentasional bersama.
 *
 * Dipakai dua tempat dengan cara berbeda:
 * - `ModelPicker.tsx` (ganti model Session berjalan) membukanya sebagai dialog.
 * - `SessionList.tsx` (buat Session baru) menyematkannya di dalam form.
 *
 * Komponen ini tidak melakukan fetch maupun simpan: pemanggil menyediakan
 * `models` dan menerima pilihan lewat `onSelect`. Aturan pencarian dan
 * pengelompokan berasal dari `lib/model-picker.ts` (murni, teruji).
 */

import { CheckIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  DEFAULT_MODEL_KEY,
  describeModelCount,
  filterModels,
  groupModels,
  optionKey,
} from "@/lib/model-picker";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/server/services/opencode-client";
import type { SessionModel } from "@/types";

export interface ModelSearchListProps {
  /** Daftar model dari server; `null` = belum dimuat. */
  models: ModelOption[] | null;
  loading: boolean;
  /** Kunci model yang sedang aktif/terpilih (lihat `keyOfSessionModel`). */
  activeKey: string;
  /** Pilihan baru; `null` = pakai model default opencode. */
  onSelect: (model: SessionModel | null) => void;
  /** Kunci aksi sementara pilihan sedang disimpan. */
  disabled?: boolean;
  /** Tinggi area daftar (kelas Tailwind); dialog memakai flex-1. */
  className?: string;
}

export function ModelSearchList({
  models,
  loading,
  activeKey,
  onSelect,
  disabled = false,
  className,
}: ModelSearchListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => filterModels(models ?? [], query), [models, query]);
  const groups = useMemo(() => groupModels(filtered), [filtered]);
  /** Opsi "default" ikut disaring agar hasil pencarian konsisten. */
  const showDefault = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" || "model default".includes(q);
  }, [query]);
  const empty = !loading && !showDefault && groups.length === 0;

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative shrink-0">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models or providers…"
          aria-label="Search models"
          className="pl-9"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading models…
          </div>
        ) : empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No models match “{query.trim()}”.
          </p>
        ) : (
          <div className="flex flex-col gap-1 pb-1">
            {showDefault && (
              <ModelRow
                name="Default model"
                hint="Follow opencode configuration"
                selected={activeKey === DEFAULT_MODEL_KEY}
                disabled={disabled}
                onSelect={() => onSelect(null)}
              />
            )}
            {groups.map((g) => (
              <div key={g.providerID} className="flex flex-col gap-1">
                <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">
                  {g.providerName}
                </p>
                {g.models.map((m) => (
                  <ModelRow
                    key={optionKey(m)}
                    name={m.name}
                    hint={m.modelID}
                    selected={activeKey === optionKey(m)}
                    disabled={disabled}
                    onSelect={() => onSelect({ providerID: m.providerID, modelID: m.modelID })}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 text-xs text-muted-foreground">
        {loading ? "Loading…" : describeModelCount(filtered.length)}
      </p>
    </div>
  );
}

interface ModelRowProps {
  name: string;
  hint: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

/** Satu baris model — `min-h-11` memberi target sentuh nyaman di HP. */
function ModelRow({ name, hint, selected, disabled, onSelect }: ModelRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-current={selected}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
        selected && "bg-accent",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{hint}</span>
      </span>
      {selected && <CheckIcon className="size-4 shrink-0 text-primary" />}
    </button>
  );
}
