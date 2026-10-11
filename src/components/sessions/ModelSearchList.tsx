/**
 * Daftar model dengan pencarian — komponen presentasional bersama.
 *
 * Dipakai dua tempat dengan cara berbeda:
 * - `ModelPicker.tsx` (ganti model Session berjalan) membukanya sebagai dialog.
 * - `NewSessionDialog.tsx` (buat Session baru) menyematkannya di dalam form.
 *
 * Gaya libadwaita (GNOME): kolom cari ala GtkSearchEntry (terisi, tanpa
 * border, tombol hapus), lalu "boxed list" per provider seperti
 * AdwPreferencesGroup — judul grup di atas kartu membulat berbaris
 * pemisah; model aktif ditandai centang di kanan (bukan latar), hasil kosong
 * memakai pola AdwStatusPage. Enter di kolom cari memilih hasil pertama.
 *
 * Komponen ini tidak melakukan fetch maupun simpan: pemanggil menyediakan
 * `models` dan menerima pilihan lewat `onSelect`. Aturan pencarian dan
 * pengelompokan berasal dari `lib/model-picker.ts` (murni, teruji).
 */

import { CheckIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { SearchEntry } from "@/components/ui/search-entry";
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
  /**
   * Kunci model aktif/terpilih (lihat `keyOfSessionModel`) — ditandai
   * centang. Tanpa nilai: tidak ada centang (mode "klik untuk mulai").
   */
  activeKey?: string;
  /** Baris yang pilihannya sedang diproses — spinner menggantikan centang. */
  pendingKey?: string | null;
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
  pendingKey = null,
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
  const isClaude = models?.[0]?.providerID === "claude-code";

  /** Enter di kolom cari: pilih hasil teratas (default bila masih tampil). */
  const pickFirst = () => {
    if (loading || disabled) return;
    if (showDefault) return onSelect(null);
    const first = groups[0]?.models[0];
    if (first) onSelect({ providerID: first.providerID, modelID: first.modelID });
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <SearchEntry
        className="shrink-0"
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            pickFirst();
          }
          // Esc: SearchEntry mengosongkan cari dulu (dialog pemanggil menahan
          // tutupnya, lihat `ModelPicker`); Esc berikutnya menutup dialog.
        }}
        placeholder={
          models && models.length > 0 ? `Search ${models.length} models…` : "Search models…"
        }
        aria-label="Search models or providers"
        aria-describedby="model-search-count"
      />
      <span id="model-search-count" className="sr-only" aria-live="polite">
        {loading ? "Loading models" : describeModelCount(filtered.length)}
      </span>

      {/* `-mx-1 px-1`: ruang untuk ring fokus baris agar tidak terpotong. */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
        {loading ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Spinner className="size-6" />
            Loading models…
          </div>
        ) : empty ? (
          // AdwStatusPage
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
            <SearchIcon className="mb-2 size-12 text-muted-foreground/40" aria-hidden />
            <p className="text-lg font-semibold">No Results Found</p>
            <p className="text-sm text-muted-foreground">
              No model matches “{query.trim()}”. Try a different search.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {showDefault && (
              <BoxedList label="Default">
                <ModelRow
                  name="Default model"
                  hint={
                    isClaude
                      ? "Follows your Claude Code settings"
                      : "Follows opencode configuration"
                  }
                  selected={activeKey === DEFAULT_MODEL_KEY}
                  pending={pendingKey === DEFAULT_MODEL_KEY}
                  disabled={disabled}
                  onSelect={() => onSelect(null)}
                />
              </BoxedList>
            )}
            {groups.map((g) => (
              <PrefsGroup key={g.providerID} title={g.providerName}>
                {g.models.map((m) => (
                  <ModelRow
                    key={optionKey(m)}
                    name={m.name}
                    hint={m.modelID}
                    selected={activeKey === optionKey(m)}
                    pending={pendingKey === optionKey(m)}
                    disabled={disabled}
                    onSelect={() => onSelect({ providerID: m.providerID, modelID: m.modelID })}
                  />
                ))}
              </PrefsGroup>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Kartu membulat berisi baris dengan garis pemisah (libadwaita `.boxed-list`). */
function BoxedList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      {children}
    </ul>
  );
}

/** Judul grup + boxed list (AdwPreferencesGroup). */
function PrefsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[13px] font-semibold">{title}</h3>
      <BoxedList label={title}>{children}</BoxedList>
    </section>
  );
}

interface ModelRowProps {
  name: string;
  hint: string;
  selected: boolean;
  /** Pilihan ini sedang diproses: spinner, tidak ikut diredupkan. */
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}

/**
 * Satu baris model (AdwActionRow yang bisa diaktifkan): judul + subjudul,
 * centang aksen di kanan untuk pilihan aktif. `min-h-13` = target sentuh
 * nyaman di HP.
 */
function ModelRow({ name, hint, selected, pending, disabled, onSelect }: ModelRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-current={selected}
        aria-busy={pending || undefined}
        className={cn(
          "flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted disabled:pointer-events-none",
          pending ? "bg-muted/60" : "disabled:opacity-50",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] leading-5">{name}</span>
          <span className="truncate text-[13px] leading-snug text-muted-foreground">{hint}</span>
        </span>
        {pending ? (
          <Spinner className="size-[18px] shrink-0 text-muted-foreground" />
        ) : (
          selected && (
            <CheckIcon
              className="size-[18px] shrink-0 text-primary"
              strokeWidth={2.5}
              aria-hidden
            />
          )
        )}
      </button>
    </li>
  );
}
