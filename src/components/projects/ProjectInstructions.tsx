/**
 * Custom instruction Project — seksi di panel samping + dialog editor.
 *
 * Instruksi disimpan lewat `PATCH /api/projects/:id` dan dikirim server
 * sebagai `system` di setiap prompt Session milik Project ini (ditambahkan
 * di atas AGENTS.md / instruksi bawaan opencode). Perubahan langsung berlaku
 * untuk prompt berikutnya, termasuk di Session yang sudah berjalan.
 */
import { PencilIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { PanelSection } from "@/components/projects/PanelSection";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

/** Sama dengan batas server (`MAX_PROJECT_INSTRUCTIONS_LENGTH`). */
const MAX_LENGTH = 20_000;

export interface ProjectInstructionsProps {
  project: Project;
  /** Dipanggil dengan Project terbaru setelah instruksi tersimpan. */
  onSaved: (project: Project) => void;
}

export function ProjectInstructions({ project, onSaved }: ProjectInstructionsProps) {
  const [open, setOpen] = useState(false);
  const instructions = project.instructions ?? "";
  const hasInstructions = instructions.length > 0;

  return (
    <PanelSection
      id="instructions"
      title="Instructions"
      action={
        hasInstructions ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setOpen(true)}
            aria-label="Edit instructions"
            title="Edit"
            className="text-muted-foreground"
          >
            <PencilIcon />
          </Button>
        ) : undefined
      }
    >
      {hasInstructions ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="line-clamp-5 text-[13px] leading-relaxed whitespace-pre-line text-foreground/85">
            {instructions}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-start gap-3 rounded-xl border border-dashed px-3.5 py-3 text-left transition-colors hover:border-solid hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PlusIcon className="size-3.5" aria-hidden />
          </span>
          <span className="flex flex-col gap-0.5 pt-0.5">
            <span className="text-sm font-medium leading-5">Add instructions</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Tell the agent how to work in this project.
            </span>
          </span>
        </button>
      )}

      <InstructionsDialog
        open={open}
        onOpenChange={setOpen}
        project={project}
        onSaved={(p) => {
          onSaved(p);
          setOpen(false);
        }}
      />
    </PanelSection>
  );
}

function InstructionsDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onSaved: (project: Project) => void;
}) {
  const fieldId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(project.instructions ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft tiap dialog dibuka — batal edit tidak meninggalkan sisa.
  useEffect(() => {
    if (!open) return;
    setDraft(project.instructions ?? "");
    setError(null);
  }, [open, project.instructions]);

  const tooLong = draft.length > MAX_LENGTH;
  const unchanged = draft.trim() === (project.instructions ?? "");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ instructions: draft }),
      });
      const body = (await res.json()) as { project: Project };
      onSaved(body.project);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save instructions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Custom instructions</DialogTitle>
          <DialogDescription>
            Sent to the agent with every prompt in {project.name}, on top of AGENTS.md. Changes
            apply from the next message.
          </DialogDescription>
        </DialogHeader>

        <form
          id={`${fieldId}-form`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooLong && !unchanged) void save();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={fieldId} className="sr-only">
            Instructions
          </label>
          <Textarea
            id={fieldId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter = simpan, seperti editor pada umumnya.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              "e.g.\n- Reply in Bahasa Indonesia\n- Use Bun, not Node\n- Keep commits small"
            }
            aria-describedby={hintId}
            aria-invalid={tooLong || undefined}
            disabled={saving}
            className="max-h-[50dvh] min-h-40 font-mono text-sm leading-relaxed"
            autoFocus
          />
          <p
            id={hintId}
            className={cn(
              "text-right text-xs tabular-nums text-muted-foreground",
              tooLong && "text-destructive",
            )}
          >
            {draft.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>

        <DialogFooter className="gap-2 sm:justify-between">
          {project.instructions ? (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground sm:mr-auto"
              disabled={saving}
              onClick={() => setDraft("")}
            >
              Clear
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={`${fieldId}-form`}
              disabled={saving || tooLong || unchanged}
            >
              {saving && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
