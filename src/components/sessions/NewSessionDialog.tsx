/**
 * Dialog pembuatan Session baru (halaman detail Project) — gaya AdwDialog
 * (libadwaita), sama dengan dialog Agent & Model:
 * - Header bar: judul "New Session" + nama Project, tombol tutup bundar.
 * - Isi: AdwToggleGroup agent (OpenCode / Claude Code), lalu daftar model
 *   (`GET /api/projects/:id/models?agent=`, dimuat saat dialog dibuka).
 * - Klik model (atau Enter di kolom cari = hasil teratas) LANGSUNG membuat
 *   Session dengan agent & model itu — tanpa tombol Create. Selama dibuat,
 *   baris yang diklik menampilkan spinner dan daftar dikunci.
 * - Di HP tampil sebagai bottom sheet (`AdwDialogContent`).
 *
 * Agent awal = agent terakhir yang dipakai (sama dengan composer homepage).
 * `POST /api/sessions` — direktori kerja memakai path Project
 * (Requirement 10.9), tipe tidak didukung ditolak (1.3). Setelah berhasil,
 * pemanggil menerima Session baru (mis. untuk langsung membukanya).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AgentLogo } from "@/components/sessions/AgentLogo";
import { AdwDialogContent } from "@/components/ui/adw-dialog";
import { AdwToggleGroup } from "@/components/ui/adw-toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import {
  AGENT_TYPE_LABELS,
  AGENT_TYPES,
  agentQuery,
  readPreferredAgentType,
  storePreferredAgentType,
} from "@/lib/agent-types";
import { ApiError, apiFetch } from "@/lib/api";
import { keyOfSessionModel } from "@/lib/model-picker";
import type { AgentType, ModelOption, Session, SessionModel } from "@/types";
import { ModelSearchList } from "./ModelSearchList";

export interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Subjudul header bar. */
  projectName: string;
  /** Dipanggil dengan Session yang baru dibuat. */
  onCreated: (session: Session) => void;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onCreated,
}: NewSessionDialogProps) {
  const [agentType, setAgentType] = useState<AgentType>(readPreferredAgentType);
  /** Kunci model yang sedang dipakai membuat Session (spinner di barisnya). */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Dibuka lagi -> mulai dari agent terakhir dipakai.
  useEffect(() => {
    if (!open) return;
    setAgentType(readPreferredAgentType());
    setCreateError(null);
  }, [open]);

  // Daftar model selalu di-fetch ulang saat dialog dibuka / agent berganti
  // agar perubahan config terlihat tanpa reload halaman. Respons usang
  // (agent sudah diganti lagi) dibuang.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setModelsLoading(true);
    setModelsError(null);
    apiFetch(`/api/projects/${projectId}/models${agentQuery(agentType)}`)
      .then(async (res) => {
        const body = (await res.json()) as { models: ModelOption[] };
        if (!stale) setModels(body.models);
      })
      .catch((e: unknown) => {
        if (stale) return;
        setModelsError(e instanceof ApiError ? e.message : "Failed to load models");
        setModels([]);
      })
      .finally(() => {
        if (!stale) setModelsLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [open, projectId, agentType]);

  /** Klik model = buat Session dengan agent & model ini, lalu buka. */
  const create = async (model: SessionModel | null) => {
    if (creating) return;
    setCreating(true);
    setPendingKey(keyOfSessionModel(model));
    setCreateError(null);
    try {
      const res = await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agentType, projectId, model }),
      });
      const { session } = (await res.json()) as { session: Session };
      storePreferredAgentType(agentType);
      onOpenChange(false);
      onCreated(session);
      toast.success("Session created.");
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Failed to create session");
    } finally {
      setCreating(false);
      setPendingKey(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (creating) return;
        onOpenChange(next);
      }}
    >
      <AdwDialogContent
        title="New Session"
        subtitle={creating ? "Starting…" : projectName}
        closeDisabled={creating}
      >
        <AdwToggleGroup
          label="Agent"
          value={agentType}
          disabled={creating}
          onChange={setAgentType}
          options={AGENT_TYPES.map((t) => ({
            value: t,
            label: AGENT_TYPE_LABELS[t],
            icon: <AgentLogo agentType={t} />,
          }))}
        />

        {createError && (
          <Alert variant="destructive">
            <AlertTitle>Failed to create session</AlertTitle>
            <AlertDescription>{createError}</AlertDescription>
          </Alert>
        )}

        {modelsError ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load models</AlertTitle>
            <AlertDescription>{modelsError}</AlertDescription>
          </Alert>
        ) : (
          // Tanpa `activeKey`: tidak ada centang — tiap baris adalah aksi
          // "mulai dengan model ini".
          <ModelSearchList
            models={models}
            loading={modelsLoading}
            pendingKey={pendingKey}
            onSelect={(model) => void create(model)}
            disabled={creating}
            className="flex-1"
          />
        )}
      </AdwDialogContent>
    </Dialog>
  );
}
