/**
 * Dialog multi-step untuk membuat Project baru (Requirement 10.2-10.4).
 *
 * Alur: Step 1 pilih direktori kerja via `FolderBrowser`, Step 2 beri nama
 * project (pre-filled dari nama folder terpilih). Dipisah dari
 * halaman daftar Project (`ProjectsPage`) agar logic wizard (step, reset
 * state) tidak bercampur dengan logic daftar Project.
 */

import { ArrowLeftIcon, ArrowRightIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useState } from "react";
import { FolderBrowser } from "@/components/projects/FolderBrowser";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dipanggil setelah Project berhasil dibuat, untuk memuat ulang daftar. */
  onCreated: () => void | Promise<void>;
}

type Step = 1 | 2;

/** Nama folder terakhir dari path relatif ("" bila root Sandbox). */
function basename(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments.at(-1) ?? "";
}

export function NewProjectDialog({ open, onOpenChange, onCreated }: NewProjectDialogProps) {
  const [step, setStep] = useState<Step>(1);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reset = () => {
    setStep(1);
    setPath("");
    setName("");
    setNameTouched(false);
    setFormError(null);
    setCreating(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const goToNaming = () => {
    setFormError(null);
    if (!nameTouched) setName(basename(path));
    setStep(2);
  };

  const backToFolder = () => {
    setFormError(null);
    setStep(1);
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      await apiFetch("/api/projects", { method: "POST", body: JSON.stringify({ name, path }) });
      await onCreated();
      handleOpenChange(false);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[560px] max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  step >= 1 ? "bg-primary" : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  step >= 2 ? "bg-primary" : "bg-muted",
                )}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground">Step {step} of 2</span>
          </div>
          <DialogTitle>{step === 1 ? "Choose working directory" : "Name your project"}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Browse the Sandbox and pick the folder to use as the working directory."
              : "This name identifies the project in the list."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <>
            <div className="min-h-0 flex-1">
              <FolderBrowser path={path} onNavigate={setPath} />
            </div>
            <DialogFooter>
              <Button type="button" onClick={goToNaming}>
                Next
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={create} className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameTouched(true);
                    }}
                    placeholder="e.g. web-app"
                    maxLength={120}
                    autoFocus
                  />
                </Field>
                <Field>
                  <FieldLabel>Working directory</FieldLabel>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                      {path === "" ? "/" : path}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2"
                      onClick={backToFolder}
                      disabled={creating}
                    >
                      Change
                    </Button>
                  </div>
                </Field>
              </FieldGroup>

              {formError && (
                <Alert variant="destructive">
                  <AlertTitle>Failed to create project</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={backToFolder} disabled={creating}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Button>
              <Button type="submit" disabled={creating || name.trim() === ""}>
                {creating ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Creating…
                  </>
                ) : (
                  <>
                    <FolderPlusIcon data-icon="inline-start" />
                    Create project
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
