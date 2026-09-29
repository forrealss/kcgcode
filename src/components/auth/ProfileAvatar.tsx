/**
 * Avatar profil pemilik (lock screen, footer sidebar, Settings). Urutan:
 * foto upload -> avatar bawaan (ikon preset) -> inisial nickname -> ikon user.
 */
import { UserIcon } from "lucide-react";
import { useState } from "react";
import { AVATAR_PRESETS } from "@/components/auth/avatar-icons";
import { initialsOf } from "@/lib/auth";
import type { AvatarPresetId } from "@/lib/avatar-presets";
import { cn } from "@/lib/utils";

export interface ProfileAvatarProps {
  nickname: string | null;
  avatarUrl: string | null;
  avatarPreset?: AvatarPresetId | null;
  className?: string;
  /** Ukuran huruf inisial mengikuti ukuran avatar. */
  textClassName?: string;
}

export function ProfileAvatar({
  nickname,
  avatarUrl,
  avatarPreset = null,
  className,
  textClassName,
}: ProfileAvatarProps) {
  // URL berbeda (foto diganti) -> coba muat lagi.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = avatarUrl !== null && failedUrl !== avatarUrl;
  const preset = !showImage && avatarPreset ? AVATAR_PRESETS[avatarPreset] : null;
  const initials = initialsOf(nickname);

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        preset ? preset.className : "bg-primary/10 text-primary",
        className,
      )}
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : preset ? (
        <preset.Icon className="size-[55%]" strokeWidth={1.75} aria-hidden />
      ) : initials ? (
        <span className={cn("font-semibold tracking-tight select-none", textClassName)}>
          {initials}
        </span>
      ) : (
        <UserIcon className="size-1/2" aria-hidden />
      )}
    </span>
  );
}
