/** Satu baris passkey: nama (bisa diganti langsung), badge Synced, waktu pakai, hapus. */
import { CheckIcon, CloudIcon, FingerprintIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/api";
import type { PasskeyInfo } from "@/lib/passkeys";
import { formatRelativeTime } from "@/lib/project-overview";
import { cn } from "@/lib/utils";

export function PasskeyRow({
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
      setError(errorText(e, "Couldn't rename the passkey."));
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
