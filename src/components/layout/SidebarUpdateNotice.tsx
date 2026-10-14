/**
 * Footer sidebar: kabar ada versi baru KCG Code di npm. Klik membuka
 * Settings -> About (berisi perintah update). Bisa ditutup — diingat per
 * versi di localStorage, jadi rilis berikutnya tetap muncul lagi.
 */
import { CircleArrowUpIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useAppInfo } from "@/hooks/useAppInfo";
import { settingsPath } from "@/lib/routes";
import { dismissUpdate, readDismissedUpdate } from "@/lib/update-prefs";

export function SidebarUpdateNotice({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { info } = useAppInfo();
  const [dismissed, setDismissed] = useState(() => readDismissedUpdate("banner"));
  const update = info?.update;
  if (!update || dismissed === update.latest) return null;

  const dismiss = () => {
    setDismissed(update.latest);
    dismissUpdate("banner", update.latest);
  };

  return (
    <div className="flex items-start rounded-md border border-[#6D5CFB]/25 bg-[#6D5CFB]/8 text-xs transition-colors hover:bg-[#6D5CFB]/12 dark:border-[#6D5CFB]/35 dark:bg-[#6D5CFB]/12">
      <button
        type="button"
        onClick={() => onNavigate(settingsPath("about"))}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-2 pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <CircleArrowUpIcon className="size-4 shrink-0 text-[#6D5CFB]" aria-hidden />
        <span className="min-w-0">
          <span className="block font-medium">Update available</span>
          <span className="block text-muted-foreground">
            v{update.latest} is out. See how to update.
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notice"
        className="m-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
