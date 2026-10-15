/**
 * Settings -> Workspace: folder tempat semua Project berada (Sandbox_Root).
 *
 * - Menampilkan folder aktif + jumlah Project, dan lokasi file config.
 * - "Change folder" membuka dialog: path absolut (`~` didukung), opsi
 *   "buat folder bila belum ada", dan konfirmasi PIN/password bila app
 *   dikunci. Server menolak folder yang terlalu luas / tumpang tindih data
 *   KCG Code, dan menolak bila masih ada Project di luar folder baru —
 *   daftar Project itu ditampilkan di dialog.
 * - Perubahan berlaku seketika (tanpa restart) dan disimpan ke config.json.
 */
import { CheckIcon, CopyIcon, FolderIcon, FolderOpenIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { SecretInput } from "@/components/auth/SecretInput";
import { ActionRow, PrefsGroup } from "@/components/settings/prefs";
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
import { ApiError, apiFetch, errorText } from "@/lib/api";
import { lockLabel } from "@/lib/auth";
import type { AuthStatus } from "@/server/services/auth";
import type { WorkspaceInfo } from "@/server/services/workspace";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; workspace: WorkspaceInfo };

export function WorkspaceGroup({ status }: { status: AuthStatus }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/workspace");
      setState({
        phase: "ready",
        workspace: ((await res.json()) as { workspace: WorkspaceInfo }).workspace,
      });
    } catch (e) {
      setState({
        phase: "error",
        message: errorText(e, "Couldn't load the workspace."),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <WorkspaceView state={state} onChange={() => setOpen(true)} />
      {state.phase === "ready" && (
        <ChangeWorkspaceDialog
          open={open}
          status={status}
          current={state.workspace}
          onOpenChange={setOpen}
          onChanged={(w) => {
            setOpen(false);
            setState({ phase: "ready", workspace: w });
            toast.success(`Workspace changed to ${w.display}.`);
          }}
        />
      )}
    </>
  );
}

/** Tampilan murni (diuji SSR). */
export function WorkspaceView({ state, onChange }: { state: LoadState; onChange: () => void }) {
  return (
    <>
      <PrefsGroup
        title="Workspace folder"
        description="Every project lives inside this folder. KCG Code and your agents can't open anything outside it."
      >
        {state.phase === "loading" ? (
          <li className="flex min-h-16 items-center justify-center px-4" role="status">
            <Spinner className="size-4 text-muted-foreground" />
            <span className="sr-only">Loading workspace…</span>
          </li>
        ) : state.phase === "error" ? (
          <li role="alert" className="px-4 py-4 text-[13px] text-destructive">
            {state.message}
          </li>
        ) : (
          <>
            <li className="flex min-h-16 items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <FolderOpenIcon className="size-[18px]" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className="truncate font-mono text-[14px] leading-5"
                  title={state.workspace.root}
                >
                  {state.workspace.display}
                </span>
                <span className="text-[13px] leading-snug text-muted-foreground">
                  {state.workspace.projectCount === 1
                    ? "1 project"
                    : `${state.workspace.projectCount} projects`}
                </span>
              </div>
              <CopyPathButton value={state.workspace.root} />
            </li>
            <ActionRow
              prefix={
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <FolderIcon className="size-[18px]" aria-hidden />
                </span>
              }
              title="Change folder"
              subtitle="Pick another folder for new and existing projects"
              onActivate={onChange}
            />
          </>
        )}
      </PrefsGroup>
      {state.phase === "ready" && (
        <p className="-mt-4 px-1 text-[12px] text-muted-foreground">
          Saved in <code className="font-mono">{state.workspace.configPath}</code>
        </p>
      )}
    </>
  );
}

function CopyPathButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={copied ? "Copied" : "Copy full path"}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
    </Button>
  );
}

// ------------------------------------------------------------- dialog ----

interface BlockingProject {
  id: string;
  name: string;
  path: string;
}

function ChangeWorkspaceDialog({
  open,
  status,
  current,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  status: AuthStatus;
  current: WorkspaceInfo;
  onOpenChange: (open: boolean) => void;
  onChanged: (w: WorkspaceInfo) => void;
}) {
  const pathId = useId();
  const secretId = useId();
  const createId = useId();
  const pathRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(current.display);
  const [create, setCreate] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<BlockingProject[]>([]);
  const kind = status.lockKind ?? "password";
  const needsSecret = status.protected;

  useEffect(() => {
    if (!open) return;
    setValue(current.display);
    setCreate(false);
    setSecret("");
    setError(null);
    setBlocking([]);
    const t = setTimeout(() => pathRef.current?.select(), 50);
    return () => clearTimeout(t);
  }, [open, current.display]);

  const unchanged = value.trim() === current.display || value.trim() === current.root;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (unchanged) return;
    setBusy(true);
    setError(null);
    setBlocking([]);
    try {
      const res = await apiFetch("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({
          path: value.trim(),
          create,
          current: needsSecret ? secret : undefined,
        }),
      });
      onChanged(((await res.json()) as { workspace: WorkspaceInfo }).workspace);
    } catch (err) {
      // 409 membawa daftar Project yang menghalangi di body respons.
      if (err instanceof ApiError && err.code === "WORKSPACE_PROJECTS_OUTSIDE") {
        const list = err.body?.projects;
        setBlocking(Array.isArray(list) ? (list as BlockingProject[]) : []);
      }
      if (err instanceof ApiError && err.code === "CURRENT_SECRET_INVALID") setSecret("");
      setError(errorText(err, "Couldn't change the workspace."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change workspace folder</DialogTitle>
          <DialogDescription>
            Projects and agents will only be able to use files inside the new folder. Nothing is
            moved or deleted.
          </DialogDescription>
        </DialogHeader>

        <form id="workspace-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-col divide-y">
                <div className="flex flex-col px-4 py-2 focus-within:bg-muted/30">
                  <label htmlFor={pathId} className="text-[12px] leading-4 text-muted-foreground">
                    Folder path
                  </label>
                  <input
                    ref={pathRef}
                    id={pathId}
                    value={value}
                    maxLength={1024}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="~/code"
                    disabled={busy}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setError(null);
                      setBlocking([]);
                    }}
                    // 16px di HP: iOS tidak men-zoom saat fokus.
                    className="h-8 w-full bg-transparent font-mono text-base outline-none placeholder:text-muted-foreground/60 sm:text-[14px]"
                  />
                </div>
                {needsSecret && (
                  <div className="flex flex-col px-4 py-2 focus-within:bg-muted/30">
                    <label
                      htmlFor={secretId}
                      className="text-[12px] leading-4 text-muted-foreground"
                    >
                      Current {lockLabel(kind)}
                    </label>
                    <SecretInput
                      id={secretId}
                      kind={kind}
                      autoComplete="current-password"
                      value={secret}
                      disabled={busy}
                      onChange={(v) => {
                        setSecret(v);
                        setError(null);
                      }}
                      className="h-8"
                    />
                  </div>
                )}
              </div>
            </div>
            <p className="px-1 text-[12px] leading-snug text-muted-foreground">
              Use a full path like <code className="font-mono">~/code</code> or{" "}
              <code className="font-mono">/srv/projects</code>. Your home folder, system folders,
              and the KCG Code data folder can't be used.
            </p>
          </div>

          <label
            htmlFor={createId}
            className="flex cursor-pointer items-center gap-3 rounded-xl px-1 text-[14px]"
          >
            <input
              id={createId}
              type="checkbox"
              checked={create}
              disabled={busy}
              onChange={(e) => setCreate(e.target.checked)}
              className="size-4 accent-primary"
            />
            Create the folder if it doesn't exist
          </label>

          {error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
            >
              <p className="flex items-start gap-2 text-destructive">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
              {blocking.length > 0 && (
                <ul className="flex flex-col gap-1 pl-6 text-[13px] text-foreground/80">
                  {blocking.map((p) => (
                    <li key={p.id} className="truncate">
                      <span className="font-medium">{p.name}</span>{" "}
                      <span className="font-mono text-muted-foreground">{p.path}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="workspace-form"
            disabled={busy || unchanged || value.trim() === "" || (needsSecret && secret === "")}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Change folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
