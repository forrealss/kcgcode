/**
 * Tombol ikon salin (Copy -> centang sementara) di atas `Button` shadcn.
 * Toast sukses/gagal opsional — tanpa `errorMessage` kegagalan diabaikan
 * diam-diam (mis. clipboard tidak tersedia di HTTP non-localhost).
 */
import { CheckIcon, CopyIcon } from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/utils";

export interface CopyIconButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "value" | "onClick" | "children"> {
  /** Teks yang disalin. */
  value: string;
  /** Label aksesibel sebelum disalin (setelahnya "Copied"). */
  label: string;
  /** Toast saat berhasil (opsional). */
  successMessage?: string;
  /** Toast saat gagal (opsional; tanpa ini gagal diam-diam). */
  errorMessage?: string;
  /** Kelas ikon (mis. ukuran). */
  iconClassName?: string;
  /** Kelas tambahan ikon centang (mis. warna sukses). */
  checkClassName?: string;
}

export function CopyIconButton({
  value,
  label,
  successMessage,
  errorMessage,
  iconClassName,
  checkClassName,
  type = "button",
  variant = "ghost",
  size = "icon",
  ...props
}: CopyIconButtonProps) {
  const { copied, copy } = useCopyToClipboard();
  const onClick = async () => {
    if (await copy(value)) {
      if (successMessage) toast.success(successMessage);
    } else if (errorMessage) {
      toast.error(errorMessage);
    }
  };
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      aria-label={copied ? "Copied" : label}
      onClick={() => void onClick()}
      {...props}
    >
      {copied ? (
        <CheckIcon className={cn(iconClassName, checkClassName)} />
      ) : (
        <CopyIcon className={iconClassName} />
      )}
    </Button>
  );
}
