/**
 * Pemilih model LLM untuk sebuah Session (meniru pilihan model di opencode).
 *
 * - Daftar model diambil dari `GET /api/projects/:id/models` — dimuat malas
 *   saat dropdown dibuka agar server headless tidak di-spawn bila user tidak
 *   mengubah model.
 * - Perubahan dikirim via `PUT /api/sessions/:id` dan berlaku pada prompt
 *   berikutnya tanpa restart Session.
 * - Nilai "Default opencode" mengirim `model: null` (opencode pakai
 *   konfigurasi default-nya).
 */

import { useCallback, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import type { ModelOption } from "@/server/services/opencode-client";
import type { SessionModel } from "@/types";

/** Nilai Select untuk "pakai default opencode". */
const DEFAULT_VALUE = "default";

/** Kunci gabungan provider+model (modelID dapat berisi "/"). */
function keyOf(providerID: string, modelID: string): string {
  return `${providerID}\u0000${modelID}`;
}

function parseKey(key: string): SessionModel | null {
  if (key === DEFAULT_VALUE) return null;
  const [providerID, modelID] = key.split("\u0000");
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

function groupByProvider(models: ModelOption[]) {
  const groups = new Map<string, { providerName: string; models: ModelOption[] }>();
  for (const m of models) {
    const g = groups.get(m.providerID);
    if (g) g.models.push(m);
    else groups.set(m.providerID, { providerName: m.providerName, models: [m] });
  }
  return [...groups.entries()].map(([providerID, g]) => ({ providerID, ...g }));
}

export interface ModelPickerProps {
  projectId: string;
  sessionId: string;
  /** Model aktif saat ini; null = default opencode. */
  model: SessionModel | null;
  /** Dipanggil setelah server menerima perubahan model. */
  onChanged: (model: SessionModel | null) => void;
}

export function ModelPicker({ projectId, sessionId, model, onChanged }: ModelPickerProps) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = model ? keyOf(model.providerID, model.modelID) : DEFAULT_VALUE;
  const currentLabel = model ? model.modelID : "Default";

  const loadModels = useCallback(async () => {
    if (models !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/models`);
      const body = (await res.json()) as { models: ModelOption[] };
      setModels(body.models);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal memuat daftar model");
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, models, loading]);

  const change = async (next: string) => {
    const parsed = parseKey(next);
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: "PUT",
        body: JSON.stringify({ model: parsed }),
      });
      onChanged(parsed);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal mengganti model");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">Model</span>
      <Select
        value={value}
        disabled={saving}
        onValueChange={(v) => void change(v)}
        onOpenChange={(open) => {
          if (open) void loadModels();
        }}
      >
        <SelectTrigger
          size="sm"
          className="min-w-0 max-w-[180px]"
          aria-label="Model Session"
          title={error ?? currentLabel}
        >
          <SelectValue placeholder="Pilih model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>Default opencode</SelectItem>
          {/* Model aktif ditampilkan walau daftar belum dimuat (label SelectValue). */}
          {model &&
            !(models ?? []).some(
              (m) => m.providerID === model.providerID && m.modelID === model.modelID,
            ) && <SelectItem value={value}>{model.modelID}</SelectItem>}
          {loading && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Memuat model…
            </div>
          )}
          {error && !loading && <div className="px-2 py-1.5 text-xs text-destructive">{error}</div>}
          {groupByProvider(models ?? []).map((g) => (
            <SelectGroup key={g.providerID}>
              <SelectLabel>{g.providerName}</SelectLabel>
              {g.models.map((m) => (
                <SelectItem
                  key={keyOf(m.providerID, m.modelID)}
                  value={keyOf(m.providerID, m.modelID)}
                >
                  {m.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {saving && <Spinner className="size-3 shrink-0 text-muted-foreground" />}
    </div>
  );
}
