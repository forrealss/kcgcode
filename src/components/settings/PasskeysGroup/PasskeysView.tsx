/** Tampilan murni grup Passkeys di Settings -> Security (daftar / kosong / memuat / error). */
import { FingerprintIcon, PlusIcon } from "lucide-react";
import { PrefsGroup } from "@/components/settings/prefs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Load } from "@/lib/load-state";
import type { PasskeyInfo } from "@/lib/passkeys";
import { PasskeyRow } from "./PasskeyRow";

/** Tampilan murni grup passkey (diuji SSR). */
export function PasskeysView({
  state,
  supported,
  onAdd,
  onRename,
  onRemove,
}: {
  state: Load<PasskeyInfo[]>;
  /** `null` = belum diketahui (sebelum mount). */
  supported: boolean | null;
  onAdd: () => void;
  onRename: (p: PasskeyInfo, name: string) => Promise<void>;
  onRemove: (p: PasskeyInfo) => void;
}) {
  const unsupported = supported === false;
  return (
    <PrefsGroup
      title="Passkeys"
      description="Unlock with your fingerprint, face, or device screen lock. Your PIN or password still works as a backup."
      suffix={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onAdd}
          disabled={unsupported || state.phase === "loading"}
        >
          <PlusIcon data-icon="inline-start" />
          Add
        </Button>
      }
    >
      {state.phase === "loading" ? (
        <li className="flex min-h-14 items-center justify-center px-4" role="status">
          <Spinner className="size-4 text-muted-foreground" />
          <span className="sr-only">Loading passkeys…</span>
        </li>
      ) : state.phase === "error" ? (
        <li role="alert" className="px-4 py-4 text-[13px] text-destructive">
          {state.message}
        </li>
      ) : state.data.length === 0 ? (
        <EmptyRow unsupported={unsupported} onAdd={onAdd} />
      ) : (
        state.data.map((p) => (
          <PasskeyRow key={p.id} passkey={p} onRename={onRename} onRemove={onRemove} />
        ))
      )}
      {unsupported && state.phase === "ready" && state.data.length > 0 && (
        <li className="px-4 py-3 text-[13px] text-muted-foreground">
          This address can't use passkeys. Open KCG Code over https or on localhost to add one.
        </li>
      )}
    </PrefsGroup>
  );
}

function EmptyRow({ unsupported, onAdd }: { unsupported: boolean; onAdd: () => void }) {
  return (
    <li className="flex flex-col items-center gap-3 px-6 py-7 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FingerprintIcon className="size-6" aria-hidden />
      </span>
      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-[15px] font-medium">No passkeys yet</p>
        <p className="text-[13px] leading-snug text-muted-foreground">
          {unsupported
            ? "Passkeys need a secure address. Open KCG Code over https or on localhost to add one."
            : "Skip typing your PIN. Add a passkey from this device to unlock in one tap."}
        </p>
      </div>
      {!unsupported && (
        <Button type="button" size="sm" variant="secondary" onClick={onAdd}>
          <FingerprintIcon data-icon="inline-start" />
          Add a passkey
        </Button>
      )}
    </li>
  );
}
