/**
 * Pemilih model LLM untuk sebuah Session (meniru pilihan model di opencode).
 *
 * Dropdown `Select` sebelumnya menyulitkan saat provider punya puluhan model:
 * tidak ada pencarian, dan di layar HP daftarnya panjang sekali. Sekarang
 * trigger membuka dialog berisi `ModelSearchList` (kolom cari + daftar
 * berkelompok per provider, model aktif ditandai).
 *
 * - Daftar model diambil dari `GET /api/projects/:id/models` — dimuat saat
 *   dialog dibuka (fetch ulang tiap kali agar config opencode yang baru
 *   ikut terbaca; server headless tidak di-spawn bila user tak pernah
 *   membuka picker).
 * - Perubahan dikirim via `PUT /api/sessions/:id` dan berlaku pada prompt
 *   berikutnya tanpa restart Session.
 * - Opsi "Model default" mengirim `model: null` (opencode memakai
 *   konfigurasi default-nya).
 * - `sessionId: null` (composer homepage, Session belum dibuat): pilihan
 *   hanya diteruskan ke `onChanged` tanpa PUT — dipakai saat membuat Session.
 * - `onAgentTypeChange` (hanya homepage): dialog menampilkan pengalih agent
 *   (OpenCode / Claude Code) di atas daftar, dan trigger membawa logo agent.
 *   Model bergantung pada agent, jadi keduanya dipilih di satu tempat.
 * - `onEffortChange`: dialog menampilkan slider thinking effort untuk model
 *   aktif (seperti `/model` Claude Code CLI) — `effort` Claude Code, variant
 *   model opencode. Hanya tampil bila model mendukungnya; ganti model
 *   mempertahankan effort bila model baru juga mendukung, selain itu default.
 */

import { ChevronDownIcon, ChevronsUpDownIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { EffortSlider } from "@/components/sessions/EffortSlider";
import { ModelSearchList } from "@/components/sessions/ModelSearchList";
import { AdwDialogContent } from "@/components/ui/adw-dialog";
import { AdwToggleGroup } from "@/components/ui/adw-toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_TYPE_LABELS, AGENT_TYPES, agentQuery } from "@/lib/agent-types";
import { apiFetch, errorText } from "@/lib/api";
import {
  activeModelLabel,
  carryEffort,
  effortLabel,
  keyOfSessionModel,
  modelEfforts,
  shortModelName,
} from "@/lib/model-picker";
import { updateSessionSettings } from "@/lib/session-api";
import type { AgentType, ModelOption, SessionModel } from "@/types";

export interface ModelPickerProps {
  projectId: string;
  /** Backend Session — daftar model opencode vs Claude Code berbeda. */
  agentType?: AgentType;
  /** null = Session belum ada; pilihan tidak disimpan ke server. */
  sessionId: string | null;
  /** Model aktif saat ini; null = default opencode. */
  model: SessionModel | null;
  /** Dipanggil setelah server menerima perubahan model. */
  onChanged: (model: SessionModel | null) => void;
  /** Thinking effort aktif; null = default model. */
  effort?: string | null;
  /**
   * Dipanggil setelah server menerima perubahan effort (dipilih, atau
   * di-reset karena model baru tidak mendukungnya). Tanpa nilai: pilihan
   * effort tidak ditampilkan.
   */
  onEffortChange?: (effort: string | null) => void;
  /**
   * Bentuk trigger:
   * - `heading` (default di header Session): judul besar tanpa border, nama
   *   model dipendekkan (`shortModelName`) — pola aplikasi chat mobile.
   * - `chip`: tombol outline ringkas untuk ditempel di dalam toolbar.
   * - `inline`: teks polos + chevron tanpa border/latar (baris di bawah
   *   composer homepage).
   */
  variant?: "heading" | "chip" | "inline";
  /**
   * Bila diisi, agent boleh diganti dari dialog ini (Session belum dibuat).
   * Pemanggil bertanggung jawab me-reset `model` saat agent berganti.
   */
  onAgentTypeChange?: (agentType: AgentType) => void;
}

export function ModelPicker({
  projectId,
  agentType = "opencode",
  sessionId,
  model,
  onChanged,
  effort = null,
  onEffortChange,
  variant = "chip",
  onAgentTypeChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = activeModelLabel(model, models ?? []);
  /** Judul header: buang prefiks vendor & potong bila panjang. */
  const headingLabel = shortModelName(label);
  /**
   * Trigger `inline` di homepage: tanpa model pilihan, tampilkan nama agent
   * ("Claude Code") — "Default model" terpotong di HP dan bertabrakan dengan
   * label mode agent ("Default") di composer.
   */
  const inlineLabel =
    onAgentTypeChange && model === null ? AGENT_TYPE_LABELS[agentType] : headingLabel;
  /** Effort pilihan ikut tampil di trigger (default tidak ditulis). */
  const effortText = effort === null ? null : effortLabel(effort);
  const describe = effortText ? `${label}, ${effortText} effort` : label;
  /** Tingkat effort model aktif — kosong sampai daftar model termuat. */
  const efforts = modelEfforts(model, models ?? []);

  // Daftar model selalu di-fetch ulang saat dialog dibuka — list di server
  // headless bisa berubah bila user mengedit config opencode (`opencode serve`
  // tidak hot-reload). Lazy: tidak di-spawn saat halaman Session dibuka.
  useEffect(() => {
    if (!open) return;
    // Agent bisa diganti saat dialog terbuka — abaikan respons fetch lama.
    let stale = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/projects/${projectId}/models${agentQuery(agentType)}`)
      .then(async (res) => {
        const body = (await res.json()) as { models: ModelOption[] };
        if (!stale) setModels(body.models);
      })
      .catch((e: unknown) => {
        if (stale) return;
        setError(errorText(e, "Failed to load model list"));
        setModels([]);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [open, projectId, agentType]);

  const choose = async (next: SessionModel | null) => {
    // Effort ikut model: tetap bila model baru mendukungnya, selain itu default.
    const nextEffort = onEffortChange ? carryEffort(effort, next, models ?? []) : effort;
    setSaving(true);
    setError(null);
    try {
      if (sessionId !== null) {
        await updateSessionSettings(sessionId, {
          model: next,
          ...(nextEffort !== effort ? { effort: nextEffort } : {}),
        });
      }
      onChanged(next);
      if (nextEffort !== effort) onEffortChange?.(nextEffort);
      setOpen(false);
    } catch (e) {
      setError(errorText(e, "Failed to change model"));
    } finally {
      setSaving(false);
    }
  };

  /** Ganti effort tanpa menutup dialog (model masih bisa diganti). */
  const chooseEffort = async (next: string | null) => {
    if (next === effort) return;
    setSaving(true);
    setError(null);
    try {
      if (sessionId !== null) {
        await updateSessionSettings(sessionId, { effort: next });
      }
      onEffortChange?.(next);
    } catch (e) {
      setError(errorText(e, "Failed to change thinking effort"));
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
          className="h-8 max-w-full min-w-0 gap-1 px-2 text-base font-semibold"
          aria-label={`Model: ${describe}. Tap to change model`}
          title={`Model: ${describe}`}
        >
          <span className="min-w-0 truncate">{headingLabel}</span>
          {effortText && (
            <span className="shrink-0 text-sm font-normal text-muted-foreground">{effortText}</span>
          )}
          {saving ? (
            <Spinner className="size-4 shrink-0" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
        </Button>
      ) : variant === "inline" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={saving}
          className="h-9 max-w-full min-w-0 gap-1 px-2 font-normal text-muted-foreground hover:text-foreground"
          aria-label={
            onAgentTypeChange
              ? `${AGENT_TYPE_LABELS[agentType]}, model: ${describe}. Tap to change`
              : `Model: ${describe}. Tap to change`
          }
          title={onAgentTypeChange ? `${AGENT_TYPE_LABELS[agentType]} · ${describe}` : describe}
        >
          {onAgentTypeChange && <AgentLogo agentType={agentType} />}
          <span className="min-w-0 truncate">{inlineLabel}</span>
          {effortText && <span className="shrink-0 text-muted-foreground/80">{effortText}</span>}
          {saving ? <Spinner data-icon="inline-end" /> : <ChevronDownIcon data-icon="inline-end" />}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={saving}
          className="h-9 max-w-full min-w-0 justify-between gap-1.5 px-2.5 font-normal"
          aria-label={`Model: ${describe}. Tap to change`}
          title={describe}
        >
          <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm">{label}</span>
          {effortText && (
            <span className="shrink-0 text-sm text-muted-foreground">{effortText}</span>
          )}
          {saving ? (
            <Spinner className="size-4 shrink-0" />
          ) : (
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
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
        {/* AdwDialog: header bar (judul + subjudul di tengah, tombol tutup
            bundar), isi preferensi di bawahnya; bottom sheet di HP. */}
        <AdwDialogContent
          title={onAgentTypeChange ? "Agent & Model" : "Model"}
          subtitle={sessionId === null ? "For the new session" : "Applies to the next message"}
          closeDisabled={saving}
        >
          {onAgentTypeChange && (
            <AdwToggleGroup
              label="Agent"
              value={agentType}
              // Tetap bisa diganti saat daftar dimuat — respons usang dibuang.
              disabled={saving}
              onChange={onAgentTypeChange}
              options={AGENT_TYPES.map((t) => ({
                value: t,
                label: AGENT_TYPE_LABELS[t],
                icon: <AgentLogo agentType={t} />,
              }))}
            />
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {onEffortChange && efforts.length > 0 && (
            <EffortSlider
              efforts={efforts}
              value={effort}
              onChange={(next) => void chooseEffort(next)}
              disabled={saving}
              className="shrink-0"
            />
          )}

          <ModelSearchList
            models={models}
            loading={loading}
            activeKey={keyOfSessionModel(model)}
            onSelect={(next) => void choose(next)}
            disabled={saving}
            className="flex-1"
          />
        </AdwDialogContent>
      </Dialog>
    </>
  );
}
