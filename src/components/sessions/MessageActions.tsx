/**
 * Aksi per pesan di footer (saat ini: Copy).
 *
 * Di perangkat ber-mouse (`pointer-fine`) tombol baru terlihat saat pesan
 * di-hover / difokus agar percakapan tetap bersih; di layar sentuh selalu
 * tampil (tidak ada hover). Pola sama dengan menu "..." di `SessionRow`.
 */
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function CopyMessageButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (text.trim() === "") return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard API butuh konteks aman (HTTPS / localhost).
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy message"}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color,background-color] outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            // Mouse: tampil saat pesan di-hover / ada fokus di dalamnya.
            "pointer-fine:opacity-0 pointer-fine:group-hover/message:opacity-100 pointer-fine:group-focus-within/message:opacity-100",
            copied && "opacity-100 pointer-fine:opacity-100",
            className,
          )}
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <CopyIcon className="size-3.5" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}
