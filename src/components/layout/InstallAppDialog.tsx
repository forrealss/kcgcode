/**
 * Dialog ajakan memasang KCG Code sebagai app (PWA), dengan manfaatnya —
 * hanya di HP/tablet yang belum memasangnya (`useInstallOffer`).
 *
 * - Chrome/Edge/Samsung (`prompt`): tombol Install memicu dialog bawaan
 *   browser. Ditolak di sana = ditunda seperti "Not now".
 * - iOS (`ios`): tidak ada API install, jadi tampilkan langkah Share ->
 *   Add to Home Screen. Di iPhone/iPad notifikasi hanya jalan dari app yang
 *   terpasang, jadi manfaat itu ikut disebut.
 * - Ditunda sebentar setelah app muncul, tidak dibuka di Session view, dan
 *   berbagi giliran dengan dialog update (`claimAnnouncement`).
 */
import { BellIcon, DownloadIcon, Maximize2Icon, ShareIcon, SmartphoneIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InstallOffer } from "@/hooks/useInstallOffer";
import { claimAnnouncement } from "@/lib/announcements";
import { type InstallOfferKind, promptInstall } from "@/lib/pwa";
import logo from "../../logo.svg";

const OPEN_DELAY_MS = 1200;

export function InstallAppDialog({
  offer,
  suppressed,
}: {
  offer: InstallOffer;
  suppressed: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Jenis yang tampil ditahan selama animasi tutup: setelah prompt dipakai,
  // `offer.kind` langsung jadi null.
  const [shown, setShown] = useState<InstallOfferKind | null>(null);
  const kind = suppressed ? null : offer.kind;

  useEffect(() => {
    if (!kind) return;
    const t = setTimeout(() => {
      if (!claimAnnouncement("install")) return;
      setShown(kind);
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [kind]);

  if (!shown) return null;

  const later = () => {
    setOpen(false);
    offer.snooze();
  };

  const install = async () => {
    setOpen(false);
    if (!(await promptInstall())) offer.snooze();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : later())}>
      <InstallAppDialogBody kind={shown} onLater={later} onInstall={() => void install()} />
    </Dialog>
  );
}

/** Isi dialog per jenis tawaran (tanpa state). */
function InstallAppDialogBody({
  kind,
  onLater,
  onInstall,
}: {
  kind: InstallOfferKind;
  onLater: () => void;
  onInstall: () => void;
}) {
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="items-center">
        <span className="mb-1 flex size-14 items-center justify-center rounded-2xl bg-[#EEEBFF] p-2.5 ring-1 ring-[#6D5CFB]/20 dark:bg-[#6D5CFB]/15 dark:ring-[#6D5CFB]/30">
          <img src={logo} alt="" className="size-full" />
        </span>
        <DialogTitle className="text-center">Install KCG Code</DialogTitle>
        <DialogDescription className="text-center">
          Add it to your home screen for the best experience on your phone.
        </DialogDescription>
      </DialogHeader>

      <ul className="flex flex-col gap-3.5">
        <Benefit icon={<Maximize2Icon />} title="More room for your chats">
          Opens full screen, without the browser's address bar and toolbars.
        </Benefit>
        <Benefit icon={<SmartphoneIcon />} title="Opens like an app">
          Launch it from your home screen and find it in the app switcher, not lost among tabs.
        </Benefit>
        {kind === "ios" && (
          <Benefit icon={<BellIcon />} title="Notifications on iPhone">
            iPhone and iPad only deliver notifications to the installed app.
          </Benefit>
        )}
      </ul>

      {kind === "ios" && (
        <ol className="flex flex-col gap-2 rounded-xl bg-muted/70 px-4 py-3 text-[13px] leading-snug">
          <Step n={1}>
            Tap <ShareIcon className="inline size-3.5 align-[-2px]" aria-label="Share" />{" "}
            <span className="font-medium">Share</span> in the browser toolbar (in newer Safari, it's
            under <span className="font-medium">⋯</span>).
          </Step>
          <Step n={2}>
            Choose <span className="font-medium">Add to Home Screen</span>.
          </Step>
          <Step n={3}>Open KCG Code from your home screen.</Step>
        </ol>
      )}

      <DialogFooter>
        {kind === "prompt" ? (
          <>
            <Button type="button" variant="outline" onClick={onLater}>
              Not now
            </Button>
            <Button type="button" onClick={onInstall}>
              <DownloadIcon data-icon="inline-start" />
              Install
            </Button>
          </>
        ) : (
          <Button type="button" onClick={onLater}>
            Got it
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

function Benefit({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#6D5CFB]/10 text-[#6D5CFB] dark:bg-[#6D5CFB]/20 [&>svg]:size-4"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm leading-5 font-medium">{title}</span>
        <span className="text-[13px] leading-snug text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold"
      >
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
