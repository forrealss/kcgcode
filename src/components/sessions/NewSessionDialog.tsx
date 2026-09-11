/**
 * Form pembuatan Session baru (dari daftar Session / halaman Project).
 *
 * Pilih tipe CLI_Agent (`opencode` | `claude-code`) + model LLM
 * (`GET /api/projects/:id/models`, dimuat malas saat dialog dibuka) lalu
 * `POST /api/sessions` — direktori kerja memakai path Project
 * (Requirement 10.9), tipe tidak didukung ditolak (1.3). Di layar HP dialog
 * ini tampil sebagai dialog agar tidak mendorong daftar ke bawah.
 */
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { keyOfSessionModel } from "@/lib/model-picker";
import type { ModelOption } from "@/server/services/opencode-client";
import type { AgentType, SessionModel } from "@/types";
import { ModelSearchList } from "./ModelSearchList";

// v1 headless: hanya opencode (claude-code punya mekanisme headless sendiri).
const AGENT_TYPES: AgentType[] = ["opencode"];

export interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Panggil setelah Session berhasil dibuat (memuat ulang daftar). */
  onCreated: () => void;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: NewSessionDialogProps) {
  const [agentType, setAgentType] = useState<AgentType>("opencode");
  /** Model pilihan untuk Session baru; null = default opencode. */
  const [selectedModel, setSelectedModel] = useState<SessionModel | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Daftar model selalu di-fetch ulang saat dialog dibuka (bukan cache
  // sekali pakai) agar perubahan config opencode terlihat tanpa reload
  // halaman. Server headless hanya di-spawn saat endpoint ini dipanggil.
  useEffect(() => {
    if (!open) return;
    setCreateError(null);
    setModelsLoading(true);
    setModelsError(null);
    apiFetch(`/api/projects/${projectId}/models`)
      .then(async (res) => {
        const body = (await res.json()) as { models: ModelOption[] };
        setModels(body.models);
      })
      .catch((e: unknown) => {
        setModelsError(e instanceof ApiError ? e.message : "Failed to load models");
        setModels([]);
      })
      .finally(() => {
        setModelsLoading(false);
      });
  }, [open, projectId]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agentType, projectId, model: selectedModel }),
      });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setCreateError(null);
      }}
    >
      {/* Tinggi dipatok: daftar model bisa panjang, jadi ia yang men-scroll
          di dalam dialog — bukan dialog yang tumbuh melewati layar HP. */}
      <DialogContent className="flex h-[80dvh] max-h-[620px] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            The session runs on a headless OpenCode server with the project path as working
            directory.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="flex min-h-0 flex-1 flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="agent-type">CLI_Agent type</FieldLabel>
            <Select value={agentType} onValueChange={(v) => setAgentType(v as AgentType)}>
              <SelectTrigger id="agent-type" className="w-full">
                <SelectValue placeholder="Choose type" />
              </SelectTrigger>
              <SelectContent>
                {AGENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <FieldLabel>Model</FieldLabel>
            {modelsError ? (
              <Alert variant="destructive">
                <AlertTitle>Failed to load models</AlertTitle>
                <AlertDescription>{modelsError}</AlertDescription>
              </Alert>
            ) : (
              <ModelSearchList
                models={models}
                loading={modelsLoading}
                activeKey={keyOfSessionModel(selectedModel)}
                onSelect={setSelectedModel}
                disabled={creating}
                className="flex-1"
              />
            )}
          </div>

          {createError && (
            <Alert variant="destructive">
              <AlertTitle>Failed to create session</AlertTitle>
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Creating…
                </>
              ) : (
                "Create session"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
