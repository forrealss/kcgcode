/**
 * Dialog "versi baru tersedia" — muncul sekali per versi saat app dibuka,
 * karena tidak semua orang membuka Settings -> About. "Update now" membuka
 * About dan memulai update di sana (progres, peringatan Session berjalan,
 * restart). Setelah ditutup ("Later", ×, Esc, atau "Update now"), versi itu
 * tidak memunculkan dialog lagi di perangkat ini; banner sidebar tetap jadi
 * pengingat.
 *
 * - Ditunda sebentar (`OPEN_DELAY_MS`) agar tidak menyerbu tepat saat app
 *   muncul (mis. setelah lock screen / welcome screen pergi).
 * - Tidak dibuka di Session view (`suppressed`): di sana pengguna sedang
 *   menjawab agent. Dialog menunggu sampai pengguna pindah halaman.
 * - Berbagi giliran dengan dialog install app (`claimAnnouncement`): bila
 *   dialog lain sudah tampil, kabar update menunggu pemuatan berikutnya.
 */
import { CircleArrowUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppInfo } from "@/hooks/useAppInfo";
import { navigate } from "@/hooks/useRouter";
import { claimAnnouncement } from "@/lib/announcements";
import { settingsPath } from "@/lib/routes";
import { requestUpdateStart } from "@/lib/self-update";
import { dismissUpdate, readDismissedUpdate, shouldOfferUpdateDialog } from "@/lib/update-prefs";

const OPEN_DELAY_MS = 1200;

export function UpdateDialog({ suppressed }: { suppressed: boolean }) {
  const { info } = useAppInfo();
  const update = info?.update ?? null;
  const [seen, setSeen] = useState(() => readDismissedUpdate("dialog"));
  const [open, setOpen] = useState(false);
  const eligible = shouldOfferUpdateDialog(update, seen, suppressed);

  useEffect(() => {
    if (!eligible) return;
    const t = setTimeout(() => {
      if (claimAnnouncement("update")) setOpen(true);
    }, OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [eligible]);

  if (!update) return null;

  const close = () => {
    setOpen(false);
    setSeen(update.latest);
    dismissUpdate("dialog", update.latest);
  };

  const updateNow = () => {
    close();
    requestUpdateStart();
    navigate(settingsPath("about"));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center sm:items-start">
          <span
            aria-hidden
            className="mb-1 flex size-10 items-center justify-center rounded-full bg-[#6D5CFB]/10 text-[#6D5CFB] dark:bg-[#6D5CFB]/20"
          >
            <CircleArrowUpIcon className="size-5" />
          </span>
          <DialogTitle>KCG Code v{update.latest} is available</DialogTitle>
          <DialogDescription>
            You're on v{update.current}. Update now and follow the progress in Settings → About.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Later
          </Button>
          <Button type="button" onClick={updateNow}>
            <CircleArrowUpIcon data-icon="inline-start" />
            Update now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
