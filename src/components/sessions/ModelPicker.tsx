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
 */

import { ChevronDownIcon, ChevronsUpDownIcon, SparklesIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { ModelSearchList } from "@/components/sessions/ModelSearchList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { AGENT_TYPE_LABELS, AGENT_TYPES, agentQuery } from "@/lib/agent-types";
import { ApiError, apiFetch } from "@/lib/api";
import { activeModelLabel, keyOfSessionModel, shortModelName } from "@/lib/model-picker";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/server/services/opencode-client";
import type { AgentType, SessionModel } from "@/types";

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
  variant = "chip",
  onAgentTypeChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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
        setError(e instanceof ApiError ? e.message : "Failed to load model list");
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
    setSaving(true);
    setError(null);
    try {
      if (sessionId !== null) {
        await apiFetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          body: JSON.stringify({ model: next }),
        });
      }
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
          className="h-8 max-w-full min-w-0 gap-1 px-2 text-base font-semibold"
          aria-label={`Model: ${label}. Tap to change model`}
          title={`Model: ${label}`}
        >
          <span className="min-w-0 truncate">{headingLabel}</span>
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
              ? `${AGENT_TYPE_LABELS[agentType]}, model: ${label}. Tap to change`
              : `Model: ${label}. Tap to change`
          }
          title={onAgentTypeChange ? `${AGENT_TYPE_LABELS[agentType]} · ${label}` : label}
        >
          {onAgentTypeChange && <AgentLogo agentType={agentType} />}
          <span className="min-w-0 truncate">{inlineLabel}</span>
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
          aria-label={`Model: ${label}. Tap to change`}
          title={label}
        >
          <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm">{label}</span>
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
            bundar), isi preferensi di bawahnya. Tinggi dipatok agar daftar
            panjang men-scroll di dalam dialog. Di HP tampil sebagai bottom
            sheet (perilaku AdwDialog di layar sempit). */}
        <DialogContent
          ref={contentRef}
          showCloseButton={false}
          onOpenAutoFocus={(e) => {
            // Desktop: langsung bisa mengetik di kolom cari. HP: jangan
            // memunculkan keyboard virtual begitu sheet terbuka.
            e.preventDefault();
            const wide = window.matchMedia("(min-width: 640px)").matches;
            const search =
              contentRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
            (wide && search ? search : contentRef.current)?.focus();
          }}
          onEscapeKeyDown={(e) => {
            // Esc saat kolom cari berisi: kosongkan cari dulu, jangan tutup.
            const el = document.activeElement;
            if (el instanceof HTMLInputElement && el.type === "search" && el.value !== "") {
              e.preventDefault();
            }
          }}
          className={cn(
            "flex h-[min(640px,85dvh)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md",
            "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:h-[85dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0",
            "max-sm:data-[state=closed]:slide-out-to-bottom-8 max-sm:data-[state=open]:slide-in-from-bottom-8",
          )}
        >
          {/* Pegangan sheet (dekoratif) — hanya di HP. */}
          <span
            aria-hidden
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30 sm:hidden"
          />
          <DialogHeader className="grid shrink-0 grid-cols-[2rem_1fr_2rem] items-center gap-2 px-3 pt-2.5 pb-2 sm:pt-3">
            <span aria-hidden />
            <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
              <DialogTitle className="truncate text-[15px] leading-5 font-bold">
                {onAgentTypeChange ? "Agent & Model" : "Model"}
              </DialogTitle>
              <DialogDescription className="truncate text-xs leading-4">
                {sessionId === null ? "For the new session" : "Applies to the next message"}
              </DialogDescription>
            </div>
            <DialogClose
              disabled={saving}
              aria-label="Close"
              className="flex size-7 items-center justify-center rounded-full bg-black/[0.06] text-foreground/80 transition-colors outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/15"
            >
              <XIcon className="size-3.5" strokeWidth={2.5} />
            </DialogClose>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {onAgentTypeChange && (
              // AdwToggleGroup: palung terisi, pilihan aktif "terangkat".
              // biome-ignore lint/a11y/useSemanticElements: grup tombol segmented, bukan fieldset form.
              <div
                role="group"
                aria-label="Agent"
                className="grid shrink-0 grid-cols-2 gap-0.5 rounded-[10px] bg-black/[0.06] p-[3px] dark:bg-white/[0.07]"
              >
                {AGENT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={t === agentType}
                    // Tetap bisa diganti saat daftar dimuat — respons usang dibuang.
                    disabled={saving}
                    onClick={() => onAgentTypeChange(t)}
                    className={cn(
                      "flex h-8 items-center justify-center gap-2 rounded-[7px] text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60",
                      t === agentType
                        ? "bg-white text-foreground shadow-sm dark:bg-white/[0.15] dark:shadow-none"
                        : "text-foreground/70 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]",
                    )}
                  >
                    <AgentLogo agentType={t} />
                    {AGENT_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            )}

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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
