/**
 * Settings -> Security -> Passkeys.
 *
 * Passkey = cara buka kunci TAMBAHAN (sidik jari, wajah, kunci layar
 * perangkat, atau security key). PIN/password tetap jadi cadangan.
 *
 * - Tambah passkey: konfirmasi PIN/password saat ini dulu, lalu dialog
 *   sistem browser. Nama bawaan dari perangkat (bisa diganti).
 * - Tiap passkey terikat ke alamat tempat didaftarkan. Passkey alamat lain
 *   tetap tampil (agar bisa dihapus) dengan label alamatnya.
 * - Alamat yang tidak mendukung passkey (http selain localhost / IP) ->
 *   tombol tambah dinonaktifkan dengan penjelasan.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  type PasskeyInfo,
  passkeysSupportedHere,
  renamePasskey,
  selectPasskeys,
} from "@/lib/passkeys";
import type { AuthStatus } from "@/server/services/auth";
import { AddPasskeyDialog } from "./AddPasskeyDialog";
import { PasskeysView } from "./PasskeysView";
import { RemovePasskeyDialog } from "./RemovePasskeyDialog";

export function PasskeysGroup({ status }: { status: AuthStatus }) {
  const [state, reload, mutate] = useApiQuery("/api/auth/passkeys", {
    select: selectPasskeys,
    errorMessage: "Couldn't load passkeys.",
  });
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  // `null` saat SSR/test; diisi setelah mount (butuh `window`).
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(passkeysSupportedHere());
  }, []);

  return (
    <>
      <PasskeysView
        state={state}
        supported={supported}
        onAdd={() => setAddOpen(true)}
        onRename={async (p, name) => {
          const updated = await renamePasskey(p.id, name);
          mutate((passkeys) =>
            passkeys.map((x) => (x.id === p.id ? { ...x, name: updated.name } : x)),
          );
        }}
        onRemove={setRemoving}
      />
      <AddPasskeyDialog
        open={addOpen}
        status={status}
        onOpenChange={setAddOpen}
        onAdded={(p) => {
          setAddOpen(false);
          toast.success(`${p.name} added. You can now unlock with it.`);
          reload();
        }}
      />
      <RemovePasskeyDialog
        passkey={removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        onRemoved={(p) => {
          setRemoving(null);
          toast.success(`${p.name} removed.`);
          mutate((passkeys) => passkeys.filter((x) => x.id !== p.id));
        }}
      />
    </>
  );
}
