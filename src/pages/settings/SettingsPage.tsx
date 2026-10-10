/**
 * Halaman Settings (`/settings/:section`) — tata letak ala GNOME Settings
 * (libadwaita): kolom sempit di tengah, grup berjudul berisi "boxed list".
 * Tiap bagian punya URL sendiri. EMPAT tab (muat di desktop & bottom nav HP):
 *
 * - Profile  (`/settings`, `/settings/profile`): avatar, nickname, dan akun
 *   KCG Code (username/email dari akun tunnel).
 * - Security (`/settings/security`): kunci aplikasi, auto-lock, passkey, dan
 *   perangkat yang login (`/settings/devices` lama -> grup ini).
 * - Workspace (`/settings/workspace`): folder tempat semua Project berada.
 * - Remote access (`/settings/remote`): tunnel publik lewat Google sign-in.
 *
 * About (`/settings/about`) bukan pengaturan — dibuka dari tombol ⓘ di
 * samping judul, bukan tab.
 */
import { ArrowLeftIcon, FolderIcon, GlobeIcon, InfoIcon, ShieldIcon, UserIcon } from "lucide-react";
import { type ComponentType, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { AvatarEditor } from "@/components/auth/AvatarEditor";
import { AboutGroup } from "@/components/settings/AboutGroup";
import { AccountGroup } from "@/components/settings/AccountGroup";
import { EntryRow, PrefsGroup } from "@/components/settings/prefs";
import { RemoteAccessGroup } from "@/components/settings/RemoteAccessGroup";
import { SecurityGroup } from "@/components/settings/SecurityGroup";
import { WorkspaceGroup } from "@/components/settings/WorkspaceGroup";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiFetch } from "@/lib/api";
import { refreshAuth, useAuth } from "@/lib/auth";
import { type SettingsSection, settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";

/** Tab Settings — sengaja dibatasi empat agar tidak sesak. */
export const SETTINGS_TABS: {
  id: Exclude<SettingsSection, "about">;
  label: string;
  /** Label ringkas untuk bottom nav mobile. */
  short?: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "security", label: "Security", icon: ShieldIcon },
  { id: "workspace", label: "Workspace", icon: FolderIcon },
  { id: "remote", label: "Remote access", short: "Remote", icon: GlobeIcon },
];

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function SettingsPage({
  section,
  anchor,
}: {
  section: SettingsSection;
  /** Grup yang dituju (mis. URL lama `/settings/devices` -> "devices"). */
  anchor?: string;
}) {
  const auth = useAuth();
  const status = auth.phase === "ready" ? auth.status : null;
  const ok = useCallback((text: string) => toast.success(text), []);
  const error = useCallback((text: string) => toast.error(text), []);
  const ready = status !== null;

  // Gulir ke grup tujuan setelah kontennya dirender.
  useEffect(() => {
    if (!anchor || !ready) return;
    const t = setTimeout(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 100);
    return () => clearTimeout(t);
  }, [anchor, ready]);

  return (
    // Mobile: ruang ekstra di bawah agar konten tidak tertutup bottom nav.
    <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-6 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-10">
      <SettingsNav current={section} />

      {!status ? (
        <div className="flex justify-center py-16" role="status">
          <Spinner className="size-6 text-muted-foreground" />
          <span className="sr-only">Loading settings…</span>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {section === "profile" && <ProfileSection status={status} onOk={ok} onError={error} />}
          {section === "security" && <SecurityGroup status={status} onOk={ok} />}
          {section === "workspace" && <WorkspaceGroup status={status} />}
          {section === "remote" && <RemoteAccessGroup protectedApp={status.protected} />}
          {section === "about" && <AboutGroup />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- nav ----

/**
 * Navigasi bagian Settings.
 * - Judul + tombol About (ⓘ) di kanannya. Di halaman About, judul berubah
 *   jadi tombol kembali — About bukan tab.
 * - sm+: deretan pil (4) di bawah judul.
 * - Mobile: bottom navigation (4 kolom, ala Material 3 NavigationBar).
 */
function SettingsNav({ current }: { current: SettingsSection }) {
  const { navigate } = useRouter();
  const go = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
  const onAbout = current === "about";
  const aboutHref = settingsPath("about");
  const backHref = settingsPath("profile");

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 px-1">
          {onAbout ? (
            <a
              href={backHref}
              onClick={go(backHref)}
              className="-ml-2 flex items-center gap-2 rounded-full py-1 pr-3 pl-2 text-2xl font-semibold tracking-tight outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ArrowLeftIcon className="size-5" aria-hidden />
              <span>Settings</span>
            </a>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          )}
          <a
            href={aboutHref}
            onClick={go(aboutHref)}
            aria-label="About KCG Code"
            aria-current={onAbout ? "page" : undefined}
            title="About KCG Code"
            className={cn(
              "flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
              onAbout && "bg-muted text-foreground",
            )}
          >
            <InfoIcon className="size-5" aria-hidden />
          </a>
        </div>
        <nav aria-label="Settings sections" className="hidden sm:block">
          <ul className="flex gap-1">
            {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
              const active = id === current;
              const href = settingsPath(id);
              return (
                <li key={id} className="shrink-0">
                  <a
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={go(href)}
                    className={cn(
                      "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <nav
        aria-label="Settings sections"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {SETTINGS_TABS.map(({ id, label, short, icon: Icon }) => {
            const active = id === current;
            const href = settingsPath(id);
            return (
              <li key={id} className="min-w-0">
                <a
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={short ? label : undefined}
                  onClick={go(href)}
                  className={cn(
                    "group flex min-h-16 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 text-[11.5px] font-medium transition-colors outline-none",
                    active ? "text-foreground" : "text-muted-foreground active:text-foreground",
                  )}
                >
                  {/* Pil indikator di belakang ikon untuk bagian aktif. */}
                  <span
                    className={cn(
                      "flex h-8 w-14 items-center justify-center rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50",
                      active
                        ? "bg-primary/15 text-primary dark:bg-primary/25"
                        : "group-active:bg-muted",
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden />
                  </span>
                  <span className="max-w-full truncate">{short ?? label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

// ----------------------------------------------------------- profile ----

function ProfileSection({
  status,
  onOk,
  onError,
}: {
  status: AuthStatus;
  onOk: (t: string) => void;
  onError: (t: string) => void;
}) {
  const saveNickname = async (next: string): Promise<string | null> => {
    try {
      await apiFetch("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname: next || null }),
      });
      await refreshAuth();
      onOk("Nickname saved.");
      return null;
    } catch (err) {
      return errorText(err, "Couldn't save nickname.");
    }
  };

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 pt-1 text-center">
          <AvatarEditor
            profile={status.profile}
            onResult={(r) => ("ok" in r ? onOk(r.ok) : onError(r.error))}
          />
          <h2 className="max-w-full truncate px-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {status.profile.nickname ?? "Your profile"}
          </h2>
        </div>

        <PrefsGroup
          title="Profile"
          description="Your name and picture appear on the lock screen and sidebar."
        >
          <EntryRow
            title="Nickname"
            value={status.profile.nickname ?? ""}
            placeholder="Add a nickname"
            maxLength={40}
            autoComplete="nickname"
            onSave={saveNickname}
          />
        </PrefsGroup>
      </div>

      <AccountGroup />
    </>
  );
}

/** Tautan antar sub-halaman Settings. */
export function SectionLink({
  section,
  children,
}: {
  section: SettingsSection;
  children: React.ReactNode;
}) {
  const { navigate } = useRouter();
  const href = settingsPath(section);
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      className="font-medium text-foreground underline underline-offset-2"
    >
      {children}
    </a>
  );
}
