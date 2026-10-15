import { CheckIcon, CopyIcon, ExternalLinkIcon, QrCodeIcon, Share2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionRow, ExpanderRow } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { QrCode } from "./QrCode";
import { RowGlyph } from "./rows";

/**
 * Baris "Your link" (dipakai kedua penyedia, di dalam boxed list):
 * - desktop: QR selalu tampil (cara tercepat pindah ke HP);
 * - baris link (mono, terpotong) + tombol salin & buka;
 * - HP: "Share link" (Web Share API) dan QR dilipat di baris expander —
 *   pengguna sudah di HP, QR jarang dibutuhkan.
 */
export function LiveAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API butuh konteks aman (HTTPS / localhost).
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  };

  // Web Share API (umumnya HP): kirim link lewat WhatsApp / email / dll.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = async () => {
    try {
      await navigator.share({ title: "KCG Code", url });
    } catch {
      /* dibatalkan pengguna */
    }
  };
  const host = url.replace(/^https?:\/\//, "");

  return (
    <>
      <li className="hidden justify-center py-5 sm:flex">
        <QrCode value={url} label="QR code of your remote access link" className="size-40" />
      </li>
      <li className="flex min-h-14 items-center gap-2 py-2 pr-2 pl-4">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate font-mono text-[14px] hover:underline"
          title={url}
        >
          {host}
        </a>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={copied ? "Copied" : "Copy link"}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon />}
        </Button>
        <Button asChild variant="ghost" size="icon-sm" className="rounded-full">
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open link in new tab">
            <ExternalLinkIcon />
          </a>
        </Button>
      </li>
      {canShare && (
        <ActionRow
          className="sm:hidden"
          prefix={<RowGlyph icon={<Share2Icon className="size-[18px]" aria-hidden />} />}
          title="Share link"
          onActivate={() => void share()}
        />
      )}
      <ExpanderRow
        className="sm:hidden"
        prefix={<RowGlyph icon={<QrCodeIcon className="size-[18px]" aria-hidden />} />}
        title="QR code"
        subtitle="Scan from another device"
      >
        <div className="flex justify-center py-2">
          <QrCode value={url} label="QR code of your remote access link" className="size-44" />
        </div>
      </ExpanderRow>
    </>
  );
}
