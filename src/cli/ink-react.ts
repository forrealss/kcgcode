/**
 * React yang sama dengan yang dipakai renderer Ink.
 *
 * Pada install global (`bun i -g kcg-code`), `ink` bisa di-hoist ke
 * node_modules global bersama React milik paket lain, sementara kcg-code
 * mendapat salinan React sendiri (`kcg-code/node_modules/react`). Hook dari
 * salinan itu tidak dikenali reconciler Ink → "Invalid hook call".
 *
 * Solusinya: ambil React dari lokasi `react-reconciler` milik Ink, sehingga
 * hook dan reconciler selalu memakai instance yang sama.
 */
import { createRequire } from "node:module";
import * as LocalReact from "react";

function resolveInkReact(): typeof LocalReact {
  try {
    const inkRequire = createRequire(Bun.resolveSync("ink", import.meta.dir));
    const reconcilerRequire = createRequire(inkRequire.resolve("react-reconciler"));
    return reconcilerRequire("react") as typeof LocalReact;
  } catch {
    // Layout tak terduga — pakai React milik paket ini.
    return LocalReact;
  }
}

export const InkReact = resolveInkReact();
