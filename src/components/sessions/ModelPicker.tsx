/**
 * Pemilih model LLM untuk sebuah Session (meniru pilihan model di opencode).
 *
 * Dropdown `Select` sebelumnya menyulitkan saat provider punya puluhan model:
 * tidak ada pencarian, dan di layar HP daftarnya panjang sekali. Sekarang
 * trigger membuka dialog berisi `ModelSearchList` (kolom cari + daftar
 * berkelompok per provider, model aktif ditandai).
 *
 * - Daftar model diambil dari `GET /api/projects/:id/models` — dimuat saat
 *   dialog pertama kali dibuka agar server headless tidak di-spawn bila user
 *   tidak pernah mengubah model.
 * - Perubahan dikirim via `PUT /api/sessions/:id` dan berlaku pada prompt
 *   berikutnya tanpa restart Session.
 * - Opsi "Model default" mengirim `model: null` (opencode memakai
 *   konfigurasi default-nya).
 */

import { ChevronDownIcon, ChevronsUpDownIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ModelSearchList } from "@/components/sessions/ModelSearchList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { activeModelLabel, keyOfSessionModel, shortModelName } from "@/lib/model-picker";
import type { ModelOption } from "@/server/services/opencode-client";
import type { SessionModel } from "@/types";

export interface ModelPickerProps {
  projectId: string;
  sessionId: string;
  /** Model aktif saat ini; null = default opencode. */
  model: SessionModel | null;
  /** Dipanggil setelah server menerima perubahan model. */
  onChanged: (model: SessionModel | null) => void;
  /**
   * Bentuk trigger:
   * - `heading` (default di header Session): judul besar tanpa border, nama
   *   model dipendekkan (`shortModelName`) — pola aplikasi chat mobile.
   * - `chip`: tombol outline ringkas untuk ditempel di dalam toolbar.
   */
  variant?: "heading" | "chip";
}

export function ModelPicker({
  projectId,
  sessionId,
  model,
  onChanged,
  variant = "chip",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = activeModelLabel(model, models ?? []);
  /** Judul header: buang prefiks vendor & potong bila panjang. */
  const headingLabel = shortModelName(label);

  const loadModels = useCallback(async () => {
    if (models !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/models`);
      const body = (await res.json()) as { models: ModelOption[] };
      setModels(body.models);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load model list");
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, models, loading]);

  // Daftar dimuat saat dialog dibuka (bukan saat mount) agar server headless
  // tidak di-spawn hanya karena halaman Session dibuka.
  useEffect(() => {
    if (open) void loadModels();
  }, [open, loadModels]);

  const choose = async (next: SessionModel | null) => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/sessions/${sessionId}`, {
        method: "PUT",
        body: JSON.stringify({ model: next }),
      });
      onChanged(next);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to change model");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {variant === "heading" ? (
        // Judul header: nama model + chevron sebagai isyarat "bisa diganti".
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpen(true)}
          disabled={saving}
          className="h-7 max-w-full min-w-0 gap-1 px-2 text-sm font-medium"
          aria-label={`Model: ${label}. Tap to change model`}
          title={`Model: ${label}`}
        >
          <span className="min-w-0 truncate">{headingLabel}</span>
          {saving ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={saving}
          className="h-8 max-w-full min-w-0 justify-between gap-1.5 px-2 font-normal"
          aria-label={`Model: ${label}. Tap to change`}
          title={label}
        >
          <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-xs">{label}</span>
          {saving ? (
            <Spinner className="size-3 shrink-0" />
          ) : (
            <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (saving) return;
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        {/* Tinggi dipatok agar daftar panjang men-scroll di dalam dialog,
            bukan menumbuhkan dialog melewati layar HP. */}
        <DialogContent className="flex h-[70dvh] max-h-[560px] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose a model</DialogTitle>
            <DialogDescription>
              Applies to the next messages — no session restart needed.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <ModelSearchList
            models={models}
            loading={loading}
            activeKey={keyOfSessionModel(model)}
            onSelect={(next) => void choose(next)}
            disabled={saving}
            className="flex-1"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
