/**
 * Settings -> Security -> Passkeys.
 *
 * Passkey = cara buka kunci TAMBAHAN (sidik jari, wajah, kunci layar
 * perangkat, atau security key). PIN/password tetap jadi cadangan.
 *
 * - Tambah passkey: konfirmasi PIN/password saat ini dulu, lalu dialog
 *   sistem browser. Nama bawaan dari perangkat (bisa diganti).
 * - Tiap passkey terikat ke alamat tempat didaftarkan. Passkey alamat lain
 *   tetap tampil (agar bisa dihapus) dengan label alamatnya.
 * - Alamat yang tidak mendukung passkey (http selain localhost / IP) ->
 *   tombol tambah dinonaktifkan dengan penjelasan.
 */
import {
  CheckIcon,
  CloudIcon,
  FingerprintIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PrefsGroup } from "@/components/settings/prefs";
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
import { ApiError } from "@/lib/api";
import { lockLabel } from "@/lib/auth";
import {
  addPasskey,
  listPasskeys,
  type PasskeyInfo,
  passkeysSupportedHere,
  removePasskey,
  renamePasskey,
} from "@/lib/passkeys";
import { formatRelativeTime } from "@/lib/project-overview";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; passkeys: PasskeyInfo[] };

export function PasskeysGroup({ status }: { status: AuthStatus }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  // `null` saat SSR/test; diisi setelah mount (butuh `window`).
  const [supported, setSupported] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ phase: "ready", passkeys: await listPasskeys() });
    } catch (e) {
      setState({
        phase: "error",
        message: e instanceof ApiError ? e.message : "Couldn't load passkeys.",
      });
    }
  }, []);

  useEffect(() => {
    setSupported(passkeysSupportedHere());
    void load();
  }, [load]);

  return (
    <>
      <PasskeysView
        state={state}
        supported={supported}
        onAdd={() => setAddOpen(true)}
        onRename={async (p, name) => {
          const updated = await renamePasskey(p.id, name);
          setState((s) =>
            s.phase === "ready"
              ? {
                  ...s,
                  passkeys: s.passkeys.map((x) =>
                    x.id === p.id ? { ...x, name: updated.name } : x,
                  ),
                }
              : s,
          );
        }}
        onRemove={setRemoving}
      />
      <AddPasskeyDialog
        open={addOpen}
        status={status}
        onOpenChange={setAddOpen}
        onAdded={(p) => {
          setAddOpen(false);
          toast.success(`${p.name} added. You can now unlock with it.`);
          void load();
        }}
      />
      <RemovePasskeyDialog
        passkey={removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        onRemoved={(p) => {
          setRemoving(null);
          toast.success(`${p.name} removed.`);
          setState((s) =>
            s.phase === "ready" ? { ...s, passkeys: s.passkeys.filter((x) => x.id !== p.id) } : s,
          );
        }}
      />
    </>
  );
}

/** Tampilan murni grup passkey (diuji SSR). */
export function PasskeysView({
  state,
  supported,
  onAdd,
  onRename,
  onRemove,
}: {
  state: LoadState;
  /** `null` = belum diketahui (sebelum mount). */
  supported: boolean | null;
  onAdd: () => void;
  onRename: (p: PasskeyInfo, name: string) => Promise<void>;
  onRemove: (p: PasskeyInfo) => void;
}) {
  const unsupported = supported === false;
  return (
    <PrefsGroup
      title="Passkeys"
      description="Unlock with your fingerprint, face, or device screen lock. Your PIN or password still works as a backup."
      suffix={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onAdd}
          disabled={unsupported || state.phase === "loading"}
        >
          <PlusIcon data-icon="inline-start" />
          Add
        </Button>
      }
    >
      {state.phase === "loading" ? (
        <li className="flex min-h-14 items-center justify-center px-4" role="status">
          <Spinner className="size-4 text-muted-foreground" />
          <span className="sr-only">Loading passkeys…</span>
        </li>
      ) : state.phase === "error" ? (
        <li role="alert" className="px-4 py-4 text-[13px] text-destructive">
          {state.message}
        </li>
      ) : state.passkeys.length === 0 ? (
        <EmptyRow unsupported={unsupported} onAdd={onAdd} />
      ) : (
        state.passkeys.map((p) => (
          <PasskeyRow key={p.id} passkey={p} onRename={onRename} onRemove={onRemove} />
        ))
      )}
      {unsupported && state.phase === "ready" && state.passkeys.length > 0 && (
        <li className="px-4 py-3 text-[13px] text-muted-foreground">
          This address can't use passkeys. Open KCG Code over https or on localhost to add one.
        </li>
      )}
    </PrefsGroup>
  );
}

function EmptyRow({ unsupported, onAdd }: { unsupported: boolean; onAdd: () => void }) {
  return (
    <li className="flex flex-col items-center gap-3 px-6 py-7 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FingerprintIcon className="size-6" aria-hidden />
      </span>
      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-[15px] font-medium">No passkeys yet</p>
        <p className="text-[13px] leading-snug text-muted-foreground">
          {unsupported
            ? "Passkeys need a secure address. Open KCG Code over https or on localhost to add one."
            : "Skip typing your PIN. Add a passkey from this device to unlock in one tap."}
        </p>
      </div>
      {!unsupported && (
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          <FingerprintIcon data-icon="inline-start" />
          Add a passkey
        </Button>
      )}
    </li>
  );
}

function PasskeyRow({
  passkey: p,
  onRename,
  onRemove,
}: {
  passkey: PasskeyInfo;
  onRename: (p: PasskeyInfo, name: string) => Promise<void>;
  onRemove: (p: PasskeyInfo) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = async () => {
    const name = draft.trim();
    if (name === p.name || name === "") {
      setEditing(false);
      setDraft(p.name);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(p, name);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't rename the passkey.");
    } finally {
      setSaving(false);
    }
  };

  const meta = [
    p.lastUsedAt ? `Used ${formatRelativeTime(p.lastUsedAt)}` : "Never used",
    `added ${formatRelativeTime(p.createdAt)}`,
  ].join(" · ");

  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-2.5">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          p.usableHere ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <FingerprintIcon className="size-[18px]" aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label htmlFor={inputId} className="sr-only">
              Passkey name
            </label>
            <input
              ref={inputRef}
              id={inputId}
              value={draft}
              maxLength={60}
              disabled={saving}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                  setDraft(p.name);
                  setError(null);
                }
              }}
              aria-invalid={error ? true : undefined}
              // 16px di HP: iOS tidak men-zoom saat fokus.
              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-[15px]"
            />
            <Button
              type="submit"
              size="icon"
              className="size-8"
              disabled={saving}
              aria-label="Save name"
            >
              {saving ? <Spinner className="size-4" /> : <CheckIcon className="size-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={saving}
              aria-label="Cancel rename"
              onClick={() => {
                setEditing(false);
                setDraft(p.name);
                setError(null);
              }}
            >
              <XIcon className="size-4" />
            </Button>
          </form>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] leading-5">{p.name}</span>
            {p.synced && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[11px] text-muted-foreground"
                title="Synced across your devices (e.g. iCloud Keychain or Google Password Manager)"
              >
                <CloudIcon className="size-3" aria-hidden />
                Synced
              </span>
            )}
          </span>
        )}
        {error ? (
          <span role="alert" className="text-[12px] text-destructive">
            {error}
          </span>
        ) : (
          <span className="truncate text-[13px] leading-snug text-muted-foreground">
            {p.usableHere ? meta : `For ${p.rpId}`}
          </span>
        )}
      </div>

      {!editing && (
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9 text-muted-foreground hover:text-foreground"
            aria-label={`Rename ${p.name}`}
            onClick={() => {
              setDraft(p.name);
              setEditing(true);
            }}
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${p.name}`}
            onClick={() => onRemove(p)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------ dialogs ----

function AddPasskeyDialog({
  open,
  status,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  status: AuthStatus;
  onOpenChange: (open: boolean) => void;
  onAdded: (p: PasskeyInfo) => void;
}) {
  const kind = status.lockKind ?? "password";
  const label = lockLabel(kind);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (current === "") return;
    setBusy(true);
    setError(null);
    const res = await addPasskey(current);
    setBusy(false);
    if (res.ok) {
      onAdded(res.data);
      return;
    }
    // Batal di dialog sistem: kembali ke dialog ini tanpa pesan merah.
    if (res.cancelled) return;
    setError(res.message);
    if (res.code === "CURRENT_SECRET_INVALID") {
      setCurrent("");
      inputRef.current?.focus();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <span className="mb-1 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FingerprintIcon className="size-7" aria-hidden />
          </span>
          <DialogTitle>Add a passkey</DialogTitle>
          <DialogDescription>
            Confirm your {label} first. Then your device will ask for your fingerprint, face, or
            screen lock.
          </DialogDescription>
        </DialogHeader>

        <form id="add-passkey-form" onSubmit={submit} className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-col px-4 py-2 focus-within:bg-muted/30">
              <label htmlFor={inputId} className="text-[12px] leading-4 text-muted-foreground">
                Current {label}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="password"
                inputMode={kind === "pin" ? "numeric" : undefined}
                autoComplete="current-password"
                maxLength={kind === "pin" ? 12 : 128}
                value={current}
                disabled={busy}
                onChange={(e) => {
                  setCurrent(kind === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value);
                  setError(null);
                }}
                className={cn(
                  "h-7 w-full bg-transparent text-base outline-none sm:text-[15px]",
                  kind === "pin" && "tracking-[0.3em]",
                )}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="px-1 text-sm text-destructive">
              {error}
            </p>
          )}
          <p className="px-1 text-[12px] leading-snug text-muted-foreground">
            The passkey works on this address only. Your fingerprint or face never leaves your
            device.
          </p>
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-passkey-form" disabled={busy || current === ""}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FingerprintIcon data-icon="inline-start" />
            )}
            {busy ? "Waiting for your device…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemovePasskeyDialog({
  passkey,
  onOpenChange,
  onRemoved,
}: {
  passkey: PasskeyInfo | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: (p: PasskeyInfo) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (passkey) setError(null);
  }, [passkey]);

  const remove = async () => {
    if (!passkey) return;
    setBusy(true);
    setError(null);
    try {
      await removePasskey(passkey.id);
      onRemoved(passkey);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove the passkey.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={passkey !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {passkey?.name}?</DialogTitle>
          <DialogDescription>
            You won't be able to unlock with it anymore. It may still appear in your device's
            password manager; you can delete it there too.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
