/**
 * Footer sidebar: profil pemilik (avatar + nickname) dengan tombol Settings
 * dan Lock. Bila kunci belum diatur, tombol Lock diganti peringatan
 * "Not protected" yang membuka Settings -> Security.
 */
import { LockIcon, SettingsIcon, ShieldAlertIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/auth/ProfileAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { lockNow, useAuth } from "@/lib/auth";
import { settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

export interface SidebarAccountProps {
  /** Halaman Settings sedang terbuka. */
  active: boolean;
  onNavigate: (path: string) => void;
}

export function SidebarAccount({ active, onNavigate }: SidebarAccountProps) {
  const auth = useAuth();
  const status = auth.phase === "ready" ? auth.status : null;
  const nickname = status?.profile.nickname ?? null;
  const avatarUrl = status?.profile.avatarUrl ?? null;
  const avatarPreset = status?.profile.avatarPreset ?? null;
  const protectedApp = status?.protected ?? false;

  const iconBtn =
    "flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

  return (
    <div className="flex flex-col gap-1">
      {status && !protectedApp && (
        <button
          type="button"
          onClick={() => onNavigate(`${settingsPath()}#security`)}
          className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-left text-xs text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
        >
          <ShieldAlertIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">Not protected</span>
            <span className="block text-amber-800/80 dark:text-amber-300/80">
              Set a lock before exposing this app.
            </span>
          </span>
        </button>
      )}

      <div className="flex min-w-0 items-center gap-1">
        <a
          href={settingsPath()}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onNavigate(settingsPath());
          }}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            active && "bg-sidebar-accent",
          )}
        >
          <ProfileAvatar
            nickname={nickname}
            avatarUrl={avatarUrl}
            avatarPreset={avatarPreset}
            className="size-8"
            textClassName="text-xs"
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium">{nickname ?? "Set up profile"}</span>
            <span className="truncate text-xs text-muted-foreground">
              {protectedApp
                ? `Locked with ${status?.lockKind === "pin" ? "PIN" : "password"}`
                : "Settings"}
            </span>
          </span>
        </a>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onNavigate(settingsPath())}
              aria-label="Settings"
              className={cn(iconBtn, active && "text-sidebar-accent-foreground")}
            >
              <SettingsIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
        </Tooltip>

        {protectedApp && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void lockNow()}
                aria-label="Lock now"
                className={iconBtn}
              >
                <LockIcon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Lock now</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
