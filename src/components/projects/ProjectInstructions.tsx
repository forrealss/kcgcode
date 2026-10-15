/**
 * Custom instruction Project — grup di panel samping (gaya libadwaita:
 * judul grup + satu baris yang membuka editor) + dialog editor.
 *
 * Instruksi disimpan lewat `PATCH /api/projects/:id` dan dikirim server
 * sebagai `system` di setiap prompt Session milik Project ini (ditambahkan
 * di atas AGENTS.md / instruksi bawaan opencode). Perubahan langsung berlaku
 * untuk prompt berikutnya, termasuk di Session yang sudah berjalan.
 */
import { ScrollTextIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
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
import { apiFetch, errorText } from "@/lib/api";
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
    <>
      {/* AdwPreferencesGroup + satu AdwActionRow yang bisa diaktifkan:
          klik baris membuka editor. */}
      <PrefsGroup
        title="Instructions"
        description="Sent with every prompt in this project, for both OpenCode and Claude Code."
      >
        <ActionRow
          prefix={<ScrollTextIcon className="size-[18px] text-muted-foreground" aria-hidden />}
          title={hasInstructions ? "Custom instructions" : "Add instructions"}
          subtitle={
            hasInstructions ? (
              <span className="line-clamp-2 whitespace-pre-line">{instructions}</span>
            ) : (
              "Like the language to reply in or tools to prefer"
            )
          }
          onActivate={() => setOpen(true)}
        />
      </PrefsGroup>

      <InstructionsDialog
        open={open}
        onOpenChange={setOpen}
        project={project}
        onSaved={(p) => {
          onSaved(p);
          setOpen(false);
        }}
      />
    </>
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
      toast.success(body.project.instructions ? "Instructions saved." : "Instructions cleared.");
    } catch (e) {
      setError(errorText(e, "Failed to save instructions"));
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
            Sent to the agent with every prompt in {project.name}, on top of AGENTS.md / CLAUDE.md.
            Changes apply from the next message.
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
