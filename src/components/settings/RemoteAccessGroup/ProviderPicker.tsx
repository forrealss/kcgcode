import { useState } from "react";
import { RowBadge } from "@/components/settings/prefs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Penyedia remote access (sinkron dengan `TunnelProvider` di server). */
export type Provider = "kcg" | "lhr";

interface ProviderInfo {
  id: Provider;
  title: string;
  /** Satu kalimat pembeda (gaya subjudul AdwActionRow). */
  subtitle: string;
  recommended?: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "kcg",
    title: "KCG Code link",
    subtitle: "Recommended · fixed address",
    recommended: true,
  },
  {
    id: "lhr",
    title: "localhost.run",
    subtitle: "No account · address changes",
  },
];

const PROVIDER_TITLE: Record<Provider, string> = { kcg: "KCG Code link", lhr: "localhost.run" };

/**
 * Pilihan penyedia sebagai kartu radio (dua kolom di layar lebar).
 * KCG Code link ditandai "Recommended"; penyedia yang sedang menyala
 * diberi penanda "On" agar jelas mana yang aktif sebelum berpindah.
 */
export function ProviderPicker({
  value,
  live,
  disabled,
  onChange,
}: {
  value: Provider | null;
  live: Provider | null;
  disabled: boolean;
  onChange: (p: Provider) => void;
}) {
  return (
    <section aria-labelledby="remote-provider" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id="remote-provider" className="text-[15px] font-semibold tracking-tight">
          Connection method
        </h2>
      </div>
      {/* Boxed list ala AdwPreferencesGroup: satu baris radio per penyedia
          (AdwActionRow + GtkCheckButton grup). Radio native di dalam label:
          panah atas/bawah & Spasi bawaan browser. */}
      <fieldset
        aria-labelledby="remote-provider"
        disabled={disabled || value === null}
        className="m-0 min-w-0 overflow-hidden rounded-xl border bg-card p-0 shadow-xs"
      >
        <ul className="flex flex-col divide-y">
          {PROVIDERS.map((p) => {
            const selected = value === p.id;
            return (
              <li key={p.id}>
                <label
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors",
                    "hover:bg-muted/60 active:bg-muted has-[:focus-visible]:bg-muted/60",
                    "has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:disabled]:hover:bg-transparent",
                  )}
                >
                  <input
                    type="radio"
                    name="remote-provider"
                    value={p.id}
                    checked={selected}
                    onChange={() => onChange(p.id)}
                    className="peer sr-only"
                  />
                  {/* Radio GTK4: lingkaran, terisi aksen + titik saat dipilih. */}
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40",
                      selected ? "border-primary bg-primary" : "border-muted-foreground/45",
                    )}
                  >
                    {selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
                    <span className="text-[15px] leading-5">{p.title}</span>
                    <span className="text-[13px] leading-snug text-muted-foreground">
                      {p.subtitle}
                    </span>
                  </span>
                  {live === p.id && <RowBadge tone="success">On</RowBadge>}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </section>
  );
}

/** Konfirmasi pindah penyedia saat penyedia lain sedang menyala. */
export function SwitchDialog({
  to,
  viaTunnel,
  busy,
  onCancel,
  onConfirm,
}: {
  to: Provider | null;
  viaTunnel: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (p: Provider) => void;
}) {
  // Simpan tujuan terakhir agar teks tidak hilang saat animasi tutup.
  const [last, setLast] = useState<Provider>("kcg");
  if (to && to !== last) setLast(to);
  const target = to ?? last;
  const from: Provider = target === "kcg" ? "lhr" : "kcg";

  return (
    <AlertDialog open={to !== null} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to {PROVIDER_TITLE[target]}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only one link can be on at a time, so your {PROVIDER_TITLE[from]} link will turn off and
            stop working. You can turn on {PROVIDER_TITLE[target]} right after.
            {viaTunnel && (
              <>
                {" "}
                <strong className="font-medium text-foreground">
                  You're using this link right now, so this page will close its connection.
                </strong>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(target);
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Switch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
