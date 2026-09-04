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
  const [path, setPath] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reset = () => {
    setStep(1);
    setPath(null);
    setName("");
    setNameTouched(false);
    setFormError(null);
    setCreating(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const pickFolder = (picked: string) => {
    setPath(picked);
    if (!nameTouched) setName(basename(picked));
  };

  const goToNaming = () => {
    if (path === null) return;
    setFormError(null);
    setStep(2);
  };

  const backToFolder = () => {
    setFormError(null);
    setStep(1);
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (path === null) return;
    setCreating(true);
    setFormError(null);
    try {
      await apiFetch("/api/projects", { method: "POST", body: JSON.stringify({ name, path }) });
      await onCreated();
      handleOpenChange(false);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Gagal membuat Project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
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
            <span className="text-xs font-medium text-muted-foreground">Langkah {step} dari 2</span>
          </div>
          <DialogTitle>{step === 1 ? "Pilih direktori kerja" : "Beri nama project"}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Jelajahi Sandbox dan pilih folder yang akan dijadikan working directory."
              : "Nama ini dipakai untuk mengenali project di daftar."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <>
            <FolderBrowser selectedPath={path ?? ""} onPick={pickFolder} />
            <DialogFooter>
              <Button type="button" onClick={goToNaming} disabled={path === null}>
                Lanjut
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={create} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project-name">Nama project</FieldLabel>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  placeholder="mis. web-app"
                  maxLength={120}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel>Direktori kerja</FieldLabel>
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
                    Ganti
                  </Button>
                </div>
              </Field>
            </FieldGroup>

            {formError && (
              <Alert variant="destructive">
                <AlertTitle>Gagal membuat Project</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={backToFolder} disabled={creating}>
                <ArrowLeftIcon data-icon="inline-start" />
                Kembali
              </Button>
              <Button type="submit" disabled={creating || name.trim() === ""}>
                {creating ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Membuat…
                  </>
                ) : (
                  <>
                    <FolderPlusIcon data-icon="inline-start" />
                    Buat project
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
