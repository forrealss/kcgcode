/**
 * Avatar yang bisa diedit (Settings -> Profile): avatar besar dengan tombol
 * pensil di pojok. Pensil membuka popover berisi:
 * - grid avatar bawaan (ikon) — klik untuk langsung dipakai,
 * - "Upload photo" untuk foto kustom (PNG/JPEG/WebP/GIF, maks 2 MB),
 * - "Remove" untuk kembali ke inisial.
 *
 * Aksesibilitas: grid = daftar tombol toggle (`aria-pressed` = pilihan saat
 * ini). Panah kiri/kanan/atas/bawah memindah fokus tanpa memilih — memilih
 * langsung menyimpan, jadi harus disengaja (Enter/Space/klik).
 */
import { CheckIcon, ImageUpIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { AVATAR_PRESETS } from "@/components/auth/avatar-icons";
import { ProfileAvatar } from "@/components/auth/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { refreshAuth } from "@/lib/auth";
import { AVATAR_PRESET_IDS, type AvatarPresetId } from "@/lib/avatar-presets";
import { cn } from "@/lib/utils";
import type { AuthProfile } from "@/server/services/auth";

const COLUMNS = 4;

export interface AvatarEditorProps {
  profile: AuthProfile;
  /** Pesan hasil (sukses / error) untuk ditampilkan pemanggil. */
  onResult: (result: { ok: string } | { error: string }) => void;
}

export function AvatarEditor({ profile, onResult }: AvatarEditorProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<AvatarPresetId | "upload" | "remove" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLFieldSetElement>(null);
  const hasAvatar = profile.avatarUrl !== null || profile.avatarPreset !== null;

  const run = async (
    kind: AvatarPresetId | "upload" | "remove",
    action: () => Promise<unknown>,
    ok: string,
  ) => {
    setBusy(kind);
    try {
      await action();
      await refreshAuth();
      onResult({ ok });
      setOpen(false);
    } catch (e) {
      onResult({ error: e instanceof ApiError ? e.message : "Couldn't update the avatar." });
    } finally {
      setBusy(null);
    }
  };

  const pickPreset = (id: AvatarPresetId) =>
    run(
      id,
      () =>
        apiFetch("/api/auth/avatar/preset", {
          method: "PUT",
          body: JSON.stringify({ preset: id }),
        }),
      "Avatar updated.",
    );

  const upload = (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return run(
      "upload",
      () => apiFetch("/api/auth/avatar", { method: "PUT", body }),
      "Photo updated.",
    );
  };

  const remove = () =>
    run("remove", () => apiFetch("/api/auth/avatar", { method: "DELETE" }), "Avatar removed.");

  // Navigasi panah di grid (roving tabindex).
  const onGridKey = (e: React.KeyboardEvent<HTMLFieldSetElement>) => {
    const items = [
      ...(gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-avatar-option]") ?? []),
    ];
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const d = step[e.key];
    if (d === undefined) return;
    e.preventDefault();
    items[(idx + d + items.length) % items.length]?.focus();
  };

  const selectedIdx = profile.avatarPreset ? AVATAR_PRESET_IDS.indexOf(profile.avatarPreset) : -1;

  return (
    <div className="relative w-fit">
      <ProfileAvatar
        nickname={profile.nickname}
        avatarUrl={profile.avatarUrl}
        avatarPreset={profile.avatarPreset}
        className="size-28 text-5xl"
        textClassName="text-4xl"
      />
      {busy === "upload" && (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
          <Spinner className="size-6" />
        </span>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Edit avatar"
            className="absolute right-0 bottom-0 flex size-9 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-md transition-transform outline-none hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:scale-105"
          >
            <PencilIcon className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="bottom"
          sideOffset={10}
          className="w-[19rem] rounded-xl p-3"
          onOpenAutoFocus={(e) => {
            // Fokus ke preset terpilih (atau pertama) agar panah langsung jalan.
            e.preventDefault();
            const items =
              gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-avatar-option]");
            items?.[Math.max(0, selectedIdx)]?.focus();
          }}
        >
          <p className="px-1 pb-2 text-sm font-semibold">Choose an avatar</p>
          <fieldset
            ref={gridRef}
            aria-label="Default avatars"
            onKeyDown={onGridKey}
            className="grid grid-cols-4 gap-2 border-0 p-0"
          >
            {AVATAR_PRESET_IDS.map((id, i) => {
              const p = AVATAR_PRESETS[id];
              const selected = profile.avatarPreset === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-avatar-option
                  aria-pressed={selected}
                  aria-label={p.label}
                  title={p.label}
                  tabIndex={i === Math.max(0, selectedIdx) ? 0 : -1}
                  disabled={busy !== null}
                  onClick={() => void pickPreset(id)}
                  className={cn(
                    "relative flex aspect-square items-center justify-center rounded-full transition-transform outline-none hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:opacity-60",
                    p.className,
                    selected && "ring-2 ring-primary ring-offset-2 ring-offset-popover",
                  )}
                >
                  {busy === id ? (
                    <Spinner className="size-5" />
                  ) : (
                    <p.Icon className="size-[55%]" strokeWidth={1.75} aria-hidden />
                  )}
                  {selected && busy !== id && (
                    <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </button>
              );
            })}
          </fieldset>

          <div className="mt-3 flex flex-col gap-1 border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {busy === "upload" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ImageUpIcon data-icon="inline-start" />
              )}
              Upload photo…
            </Button>
            {hasAvatar && (
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive"
                disabled={busy !== null}
                onClick={() => void remove()}
              >
                {busy === "remove" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Trash2Icon data-icon="inline-start" />
                )}
                Remove avatar
              </Button>
            )}
            <p className="px-3 pt-1 text-[11px] text-muted-foreground">
              PNG, JPEG, WebP or GIF, up to 2 MB.
            </p>
          </div>
        </PopoverContent>
      </Popover>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
    </div>
  );
}
