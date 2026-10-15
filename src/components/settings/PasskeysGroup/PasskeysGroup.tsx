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
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorText } from "@/lib/api";
import {
  listPasskeys,
  type PasskeyInfo,
  passkeysSupportedHere,
  renamePasskey,
} from "@/lib/passkeys";
import type { AuthStatus } from "@/server/services/auth";
import { AddPasskeyDialog } from "./AddPasskeyDialog";
import { type LoadState, PasskeysView } from "./PasskeysView";
import { RemovePasskeyDialog } from "./RemovePasskeyDialog";

export function PasskeysGroup({ status }: { status: AuthStatus }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  // `null` saat SSR/test; diisi setelah mount (butuh `window`).
  const [supported, setSupported] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ phase: "ready", passkeys: await listPasskeys() });
    } catch (e) {
      setState({ phase: "error", message: errorText(e, "Couldn't load passkeys.") });
    }
  }, []);

  useEffect(() => {
    setSupported(passkeysSupportedHere());
    void load();
  }, [load]);

  return (
    <>
      <PasskeysView
        state={state}
        supported={supported}
        onAdd={() => setAddOpen(true)}
        onRename={async (p, name) => {
          const updated = await renamePasskey(p.id, name);
          setState((s) =>
            s.phase === "ready"
              ? {
                  ...s,
                  passkeys: s.passkeys.map((x) =>
                    x.id === p.id ? { ...x, name: updated.name } : x,
                  ),
                }
              : s,
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
          void load();
        }}
      />
      <RemovePasskeyDialog
        passkey={removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        onRemoved={(p) => {
          setRemoving(null);
          toast.success(`${p.name} removed.`);
          setState((s) =>
            s.phase === "ready" ? { ...s, passkeys: s.passkeys.filter((x) => x.id !== p.id) } : s,
          );
        }}
      />
    </>
  );
}
