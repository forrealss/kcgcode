/** Welcome screen, langkah 3: pasang PIN/password (direkomendasikan, bisa dilewati). */
import { LockIcon, ShieldCheckIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { LockKindPicker } from "@/components/auth/LockKindPicker";
import { SecretInput } from "@/components/auth/SecretInput";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedFocus } from "@/hooks/useDelayedFocus";
import { apiFetch, errorText } from "@/lib/api";
import { lockLabel } from "@/lib/auth";
import { type LockKind, validateNewLock } from "@/lib/lock-secret";
import { StepHeader } from "./primitives";

export function LockStep({ onDone }: { onDone: (kind: LockKind | null) => void }) {
  const [kind, setKind] = useState<LockKind>("pin");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secretId = useId();
  const confirmId = useId();
  const secretRef = useRef<HTMLInputElement>(null);

  useDelayedFocus(secretRef, 350, { preventScroll: true });

  const label = lockLabel(kind);
  const hint =
    kind === "pin"
      ? "6–12 digits. Avoid repeated or sequential digits."
      : "At least 8 characters. A short phrase works well.";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateNewLock(kind, secret, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/lock", { method: "PUT", body: JSON.stringify({ kind, secret }) });
      onDone(kind);
    } catch (err) {
      setError(errorText(err, "Couldn't save the lock."));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    id: string,
    title: string,
    value: string,
    set: (v: string) => void,
    ref?: React.Ref<HTMLInputElement>,
  ) => (
    <div className="flex flex-col px-4 py-2.5 focus-within:bg-muted/30">
      <label htmlFor={id} className="text-[12px] leading-4 text-muted-foreground">
        {title}
      </label>
      <SecretInput
        ref={ref}
        id={id}
        kind={kind}
        autoComplete="new-password"
        value={value}
        disabled={busy}
        onChange={(v) => {
          set(v);
          setError(null);
        }}
        className="h-8"
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-7">
      <StepHeader
        icon={ShieldCheckIcon}
        title="Lock your workspace"
        description="Anyone who can open this page can control your agents. A lock keeps it yours, especially when you use Remote access."
      />

      {/* Segmented control ala GNOME (sama dengan dialog di Settings). */}
      <LockKindPicker
        name="welcome-lock-kind"
        aria-label="Lock type"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setSecret("");
          setConfirm("");
          setError(null);
        }}
      />

      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-col divide-y">
            {field(secretId, `New ${label}`, secret, setSecret, secretRef)}
            {field(confirmId, `Confirm ${label}`, confirm, setConfirm)}
          </div>
        </div>
        <p className="px-1 text-[12px] text-muted-foreground">{hint}</p>
        {error && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          disabled={busy || secret === "" || confirm === ""}
          className="h-12 rounded-full text-[15px]"
        >
          {busy ? <Spinner data-icon="inline-start" /> : <LockIcon data-icon="inline-start" />}
          Turn on lock
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => onDone(null)}
          className="h-10 rounded-full text-muted-foreground"
        >
          Skip, I'll do it later
        </Button>
      </div>
    </form>
  );
}
