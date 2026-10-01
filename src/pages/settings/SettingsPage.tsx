/**
 * Halaman Settings (`/settings/:section`) — tata letak ala GNOME Settings
 * (libadwaita): kolom sempit di tengah, grup berjudul berisi "boxed list".
 * Tiap bagian punya URL sendiri, dipilih lewat navigasi tab di atas konten:
 *
 * - Profile  (`/settings`, `/settings/profile`): avatar, nickname, dan akun
 *   KCG Code (username/email dari akun tunnel).
 * - Security (`/settings/security`): kunci aplikasi, jenis kunci, auto-lock.
 * - Remote access (`/settings/remote`): tunnel publik lewat Google sign-in.
 * - Devices  (`/settings/devices`): sesi login per perangkat.
 * - About    (`/settings/about`): logo, versi, dan kredit tim.
 */
import { GlobeIcon, InfoIcon, MonitorSmartphoneIcon, ShieldIcon, UserIcon } from "lucide-react";
import { type ComponentType, useCallback } from "react";
import { toast } from "sonner";
import { AvatarEditor } from "@/components/auth/AvatarEditor";
import { AboutGroup } from "@/components/settings/AboutGroup";
import { AccountGroup } from "@/components/settings/AccountGroup";
import { DevicesGroup } from "@/components/settings/DevicesGroup";
import { EntryRow, PrefsGroup } from "@/components/settings/prefs";
import { RemoteAccessGroup } from "@/components/settings/RemoteAccessGroup";
import { SecurityGroup } from "@/components/settings/SecurityGroup";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiFetch } from "@/lib/api";
import { refreshAuth, useAuth } from "@/lib/auth";
import { type SettingsSection, settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";

const SECTIONS: {
  id: SettingsSection;
  label: string;
  /** Label ringkas untuk bottom nav mobile (5 kolom sempit). */
  short?: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "security", label: "Security", icon: ShieldIcon },
  { id: "remote", label: "Remote access", short: "Remote", icon: GlobeIcon },
  { id: "devices", label: "Devices", icon: MonitorSmartphoneIcon },
  { id: "about", label: "About", icon: InfoIcon },
];

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const auth = useAuth();
  const status = auth.phase === "ready" ? auth.status : null;
  const ok = useCallback((text: string) => toast.success(text), []);
  const error = useCallback((text: string) => toast.error(text), []);

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
          {section === "remote" && <RemoteAccessGroup protectedApp={status.protected} />}
          {section === "devices" && <DevicesSection status={status} onError={error} />}
          {section === "about" && <AboutGroup />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- nav ----

/**
 * Navigasi bagian Settings.
 * - sm+: deretan pil di bawah judul.
 * - Mobile: bottom navigation tetap di bawah layar (ikon + label, ala
 *   Material 3 NavigationBar) — terjangkau jempol dan tidak memakan
 *   tinggi di atas konten.
 */
function SettingsNav({ current }: { current: SettingsSection }) {
  const { navigate } = useRouter();
  const go = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <h1 className="px-1 text-2xl font-semibold tracking-tight">Settings</h1>
        <nav aria-label="Settings sections" className="hidden sm:block">
          <ul className="flex gap-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
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
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {SECTIONS.map(({ id, label, short, icon: Icon }) => {
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

// ----------------------------------------------------------- devices ----

function DevicesSection({ status, onError }: { status: AuthStatus; onError: (t: string) => void }) {
  if (status.protected) return <DevicesGroup onError={onError} />;
  return (
    <PrefsGroup title="Signed-in devices" description="Devices that have unlocked KCG Code.">
      <li className="px-4 py-4 text-[13px] text-muted-foreground">
        Devices are tracked once an app lock is set. Turn it on in{" "}
        <SectionLink section="security">Security</SectionLink>.
      </li>
    </PrefsGroup>
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
