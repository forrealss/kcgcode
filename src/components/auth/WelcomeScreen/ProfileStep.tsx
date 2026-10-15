/** Welcome screen, langkah 2: nickname (opsional), disimpan ke profil. */
import { ArrowRightIcon, UserRoundIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedFocus } from "@/hooks/useDelayedFocus";
import { apiFetch, errorText } from "@/lib/api";
import { StepHeader } from "./primitives";

export function ProfileStep({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDelayedFocus(inputRef, 350, { preventScroll: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname: value.trim() || null }),
      });
      onNext();
    } catch (err) {
      setError(errorText(err, "Couldn't save your name."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <StepHeader
        icon={UserRoundIcon}
        title="What should we call you?"
        description="Your name appears on the lock screen and in the sidebar. You can change it later."
      />

      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs focus-within:ring-[3px] focus-within:ring-ring/30">
          <div className="flex flex-col px-4 py-2.5">
            <label htmlFor={id} className="text-[12px] leading-4 text-muted-foreground">
              Nickname
            </label>
            <input
              ref={inputRef}
              id={id}
              value={value}
              maxLength={40}
              autoComplete="nickname"
              placeholder="e.g. Irsyad"
              onChange={(e) => {
                onChange(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              // 16px di HP: iOS tidak men-zoom saat fokus.
              className="h-8 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60 sm:text-[15px]"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <Button type="submit" disabled={saving} className="h-12 rounded-full text-[15px]">
        {saving && <Spinner data-icon="inline-start" />}
        {value.trim() ? "Continue" : "Skip"}
        {!saving && <ArrowRightIcon data-icon="inline-end" />}
      </Button>
    </form>
  );
}
