/**
 * Ajakan memasang KCG Code sebagai app (PWA) di HP — dibuka dari home screen
 * tanpa address bar browser.
 *
 * - Chrome/Edge/Samsung: tombol Install memicu dialog bawaan browser.
 * - iOS Safari: tidak ada API install, jadi tampilkan langkah Share -> Add to
 *   Home Screen.
 * - Alamat localhost.run (`*.lhr.life`): berubah tiap sambung ulang, app yang
 *   di-install dari sana akan basi. Ganti dengan catatan "alamat sementara"
 *   yang mengarah ke KCG Code link (alamat tetap).
 *
 * Disembunyikan di desktop, saat sudah berjalan sebagai app, atau setelah
 * ditutup (diingat per origin di localStorage).
 */
import { DownloadIcon, ShareIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsBelowMd } from "@/hooks/useMediaQuery";
import { useRouter } from "@/hooks/useRouter";
import { isEphemeralHost, isIOS, isStandalone, promptInstall, useInstallState } from "@/lib/pwa";
import { settingsPath } from "@/lib/routes";

const DISMISS_KEY = "kcg-install-banner-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallAppBanner() {
  const isMobile = useIsBelowMd();
  const { navigate } = useRouter();
  const { canPrompt, installed } = useInstallState();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!isMobile || dismissed || installed || isStandalone()) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* tetap tertutup untuk tab ini */
    }
  };

  if (isEphemeralHost(window.location.hostname)) {
    return (
      <Banner
        icon={<TriangleAlertIcon />}
        tone="warning"
        title="Temporary link"
        description="This address changes when it reconnects, so it can't be installed as an app. Use KCG Code link for a fixed address."
        action={
          <Button size="sm" variant="outline" onClick={() => navigate(settingsPath("remote"))}>
            Remote access
          </Button>
        }
        onDismiss={dismiss}
      />
    );
  }

  if (canPrompt) {
    return (
      <Banner
        icon={<DownloadIcon />}
        title="Install KCG Code"
        description="Open it from your home screen, without the browser bar."
        action={
          <Button size="sm" onClick={() => void promptInstall()}>
            Install
          </Button>
        }
        onDismiss={dismiss}
      />
    );
  }

  if (isIOS(navigator.userAgent, navigator.maxTouchPoints)) {
    return (
      <Banner
        icon={<ShareIcon />}
        title="Install KCG Code"
        description={
          <>
            Tap <ShareIcon className="inline size-3.5 align-[-2px]" aria-label="Share" />, then{" "}
            <span className="font-medium text-foreground">Add to Home Screen</span>.
          </>
        }
        onDismiss={dismiss}
      />
    );
  }

  return null;
}

function Banner({
  icon,
  title,
  description,
  action,
  tone,
  onDismiss,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  tone?: "warning";
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label={title}
      className="mx-3 mb-1 flex items-start gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-xs"
    >
      <span
        aria-hidden
        className={
          tone === "warning"
            ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 [&>svg]:size-4"
            : "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&>svg]:size-4"
        }
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm leading-5 font-medium">{title}</p>
          <p className="text-[13px] leading-snug text-muted-foreground">{description}</p>
        </div>
        {action && <div>{action}</div>}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        className="-mt-1 -mr-1.5 text-muted-foreground"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <XIcon />
      </Button>
    </section>
  );
}
