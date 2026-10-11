/**
 * Halaman Settings (`/settings/:section`) — navigasi ala GNOME Settings
 * (AdwNavigationSplitView, libadwaita). Isi tiap bagian memakai "boxed list"
 * (`components/settings/prefs`). Tiap bagian punya URL sendiri:
 *
 * - Profile  (`/settings`, `/settings/profile`): avatar, nickname, akun.
 * - Security (`/settings/security`): kunci aplikasi, auto-lock, passkey, dan
 *   perangkat yang login (`/settings/devices` lama -> grup ini).
 * - Workspace (`/settings/workspace`): folder tempat semua Project berada.
 * - Remote access (`/settings/remote`): tunnel publik lewat Google sign-in.
 * - About KCG Code (`/settings/about`): versi & kredit — bukan pengaturan,
 *   jadi tampil terpisah di akhir navigasi (seperti "About" GNOME Settings).
 *
 * Tata letak:
 * - Lebar (lg+): daftar navigasi di kiri (sticky), isi bagian di kanan.
 * - Sempit: `/settings` = daftar bagian (baris dengan ikon, deskripsi,
 *   chevron); bagian dibuka sebagai halaman dengan tombol kembali
 *   "‹ Settings" + judul di tengah (AdwNavigationView).
 */
import { ChevronLeftIcon, FolderIcon, GlobeIcon, ShieldIcon, UserIcon } from "lucide-react";
import { type ComponentType, type ReactNode, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { AvatarEditor } from "@/components/auth/AvatarEditor";
import { ProfileAvatar } from "@/components/auth/ProfileAvatar";
import { AboutGroup } from "@/components/settings/AboutGroup";
import { AccountGroup } from "@/components/settings/AccountGroup";
import { ActionRow, EntryRow, PrefsGroup } from "@/components/settings/prefs";
import { RemoteAccessGroup } from "@/components/settings/RemoteAccessGroup";
import { SecurityGroup } from "@/components/settings/SecurityGroup";
import { WorkspaceGroup } from "@/components/settings/WorkspaceGroup";
import { Spinner } from "@/components/ui/spinner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useRouter } from "@/hooks/useRouter";
import { ApiError, apiFetch } from "@/lib/api";
import { refreshAuth, useAuth } from "@/lib/auth";
import { type SettingsSection, settingsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";
import logo from "../../logo.svg";

/** Logo aplikasi sebagai ikon navigasi "About KCG Code". */
function AppIcon({ className }: { className?: string }) {
  return <img src={logo} alt="" className={cn("rounded-[22%]", className)} />;
}

export interface SettingsPageInfo {
  id: SettingsSection;
  label: string;
  /** Subjudul baris di daftar bagian (layar sempit). */
  description: string;
  icon: ComponentType<{ className?: string }>;
}

/** Bagian pengaturan (urutan navigasi). About sengaja terpisah. */
export const SETTINGS_PANELS: readonly SettingsPageInfo[] = [
  {
    id: "profile",
    label: "Profile",
    description: "Name, picture & account",
    icon: UserIcon,
  },
  {
    id: "security",
    label: "Security",
    description: "App lock, passkeys & devices",
    icon: ShieldIcon,
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Where your projects live",
    icon: FolderIcon,
  },
  {
    id: "remote",
    label: "Remote access",
    description: "Open KCG Code from anywhere",
    icon: GlobeIcon,
  },
];

/** Entri "About" — selalu terakhir, dipisah dari bagian pengaturan. */
export const SETTINGS_ABOUT: SettingsPageInfo = {
  id: "about",
  label: "About KCG Code",
  description: "Version & credits",
  icon: AppIcon,
};

function pageInfo(section: SettingsSection): SettingsPageInfo {
  return SETTINGS_PANELS.find((p) => p.id === section) ?? SETTINGS_ABOUT;
}

/** Breakpoint `lg` — di atasnya navigasi & isi berdampingan. */
const WIDE_QUERY = "(min-width: 1024px)";

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** Tautan SPA (Ctrl/Cmd-klik tetap membuka tab baru). */
function useNavLink() {
  const { navigate } = useRouter();
  return (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
}

export function SettingsPage({
  section,
  anchor,
  root = false,
}: {
  section: SettingsSection;
  /** Grup yang dituju (mis. URL lama `/settings/devices` -> "devices"). */
  anchor?: string;
  /** `/settings` tanpa sub-halaman (layar sempit: daftar bagian). */
  root?: boolean;
}) {
  const auth = useAuth();
  const status = auth.phase === "ready" ? auth.status : null;
  const ok = useCallback((text: string) => toast.success(text), []);
  const error = useCallback((text: string) => toast.error(text), []);
  const ready = status !== null;
  const wide = useMediaQuery(WIDE_QUERY);

  // Gulir ke grup tujuan setelah kontennya dirender.
  useEffect(() => {
    if (!anchor || !ready) return;
    const t = setTimeout(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 100);
    return () => clearTimeout(t);
  }, [anchor, ready]);

  const content = !status ? (
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
  );

  // Lebar: AdwNavigationSplitView — sidebar navigasi + isi.
  if (wide) {
    return (
      <div className="grid grid-cols-[14.5rem_minmax(0,1fr)] gap-10 pt-2 pb-10">
        <SettingsSidebar current={section} />
        <div className="flex min-w-0 max-w-[40rem] flex-col gap-6">
          <h2 className="px-1 text-2xl font-semibold tracking-tight">{pageInfo(section).label}</h2>
          {content}
        </div>
      </div>
    );
  }

  // Sempit, `/settings`: daftar bagian.
  if (root) return <SettingsIndex status={status} />;

  // Sempit, sub-halaman: tombol kembali + judul di tengah.
  return (
    <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <SubpageHeader title={pageInfo(section).label} />
      {content}
    </div>
  );
}

// ---------------------------------------------------------------- nav ----

/**
 * Sidebar navigasi (layar lebar) — gaya `.navigation-sidebar` libadwaita:
 * baris ikon + label, pilihan aktif berlatar membulat. About di bawah garis
 * pemisah, dengan logo aplikasi sebagai ikon.
 */
function SettingsSidebar({ current }: { current: SettingsSection }) {
  const link = useNavLink();
  const item = ({ id, label, icon: Icon }: SettingsPageInfo) => {
    const href = settingsPath(id);
    const active = id === current;
    return (
      <li key={id}>
        <a
          href={href}
          onClick={link(href)}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            active
              ? "bg-black/[0.08] font-medium text-foreground dark:bg-white/[0.1]"
              : "text-foreground/80 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]",
          )}
        >
          <Icon className="size-[18px] shrink-0" />
          <span className="truncate">{label}</span>
        </a>
      </li>
    );
  };
  return (
    <nav aria-label="Settings" className="sticky top-2 flex flex-col gap-3 self-start">
      <h1 className="px-3 text-2xl font-semibold tracking-tight">Settings</h1>
      <ul className="flex flex-col gap-0.5">{SETTINGS_PANELS.map(item)}</ul>
      <div className="mx-3 h-px bg-border" aria-hidden />
      <ul className="flex flex-col gap-0.5">{item(SETTINGS_ABOUT)}</ul>
    </nav>
  );
}

/**
 * Daftar bagian (layar sempit, `/settings`) — boxed list ala GNOME Settings
 * mobile: profil di atas (avatar + nama), lalu bagian pengaturan, lalu
 * About di grup sendiri.
 */
function SettingsIndex({ status }: { status: AuthStatus | null }) {
  const { navigate } = useRouter();
  const profile = status?.profile;
  const row = (p: SettingsPageInfo, overrides?: { title?: ReactNode; prefix?: ReactNode }) => (
    <ActionRow
      key={p.id}
      prefix={overrides?.prefix ?? <p.icon className="size-[18px] text-muted-foreground" />}
      title={overrides?.title ?? p.label}
      subtitle={p.description}
      onActivate={() => navigate(settingsPath(p.id))}
    />
  );
  const [profilePanel, ...panels] = SETTINGS_PANELS;

  return (
    <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <h1 className="px-1 text-2xl font-semibold tracking-tight">Settings</h1>
      {profilePanel && (
        <PrefsGroup>
          {row(profilePanel, {
            title: profile?.nickname ?? "Profile",
            prefix: (
              <ProfileAvatar
                nickname={profile?.nickname ?? null}
                avatarUrl={profile?.avatarUrl ?? null}
                avatarPreset={profile?.avatarPreset ?? null}
                className="size-10"
                textClassName="text-base"
              />
            ),
          })}
        </PrefsGroup>
      )}
      <PrefsGroup>{panels.map((p) => row(p))}</PrefsGroup>
      <PrefsGroup>
        {row(SETTINGS_ABOUT, { prefix: <AppIcon className="size-[22px]" /> })}
      </PrefsGroup>
    </div>
  );
}

/** Header sub-halaman (layar sempit): "‹ Settings" + judul di tengah. */
function SubpageHeader({ title }: { title: string }) {
  const link = useNavLink();
  const href = settingsPath();
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <a
        href={href}
        onClick={link(href)}
        className="-ml-2 flex w-fit items-center gap-0.5 rounded-full py-1.5 pr-3 pl-1.5 text-[15px] font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
      >
        <ChevronLeftIcon className="size-5" aria-hidden />
        Settings
      </a>
      <h1 className="truncate text-center text-[17px] font-bold">{title}</h1>
      <span aria-hidden />
    </header>
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
