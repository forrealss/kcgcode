/**
 * Passkey UI — render statis: grup Settings (kosong / daftar / tidak
 * didukung) dan tampilan passkey di lock screen.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PasskeyInfo } from "@/lib/passkeys";
import { PasskeyEntry } from "../../auth/LockScreen";
import { PasskeysView } from "../PasskeysGroup";

const noop = () => {};
const noopAsync = async () => {};

const pk = (over: Partial<PasskeyInfo> = {}): PasskeyInfo => ({
  id: "p1",
  name: "Passkey on iPhone",
  rpId: "me.kcgcode.dev",
  synced: true,
  createdAt: Date.now() - 2 * 86_400_000,
  lastUsedAt: null,
  usableHere: true,
  ...over,
});

function view(state: Parameters<typeof PasskeysView>[0]["state"], supported: boolean | null) {
  return renderToStaticMarkup(
    <PasskeysView
      state={state}
      supported={supported}
      onAdd={noop}
      onRename={noopAsync}
      onRemove={noop}
    />,
  );
}

describe("Settings -> Passkeys", () => {
  test("kosong: ajakan menambah + tombol Add", () => {
    const out = view({ phase: "ready", passkeys: [] }, true);
    expect(out).toContain("Passkeys");
    expect(out).toContain("No passkeys yet");
    expect(out).toContain("Add a passkey");
    expect(out).toContain("still works as a backup");
  });

  test("alamat tidak didukung: tombol Add nonaktif + penjelasan", () => {
    const out = view({ phase: "ready", passkeys: [] }, false);
    expect(out).toContain("Passkeys need a secure address");
    expect(out).not.toContain("Add a passkey");
    expect(out).toMatch(/disabled=""[^>]*>.*Add<\/button>/s);
  });

  test("daftar: nama, badge Synced, belum pernah dipakai, aksi rename/hapus berlabel", () => {
    const out = view({ phase: "ready", passkeys: [pk()] }, true);
    expect(out).toContain("Passkey on iPhone");
    expect(out).toContain("Synced");
    expect(out).toContain("Never used");
    expect(out).toContain('aria-label="Rename Passkey on iPhone"');
    expect(out).toContain('aria-label="Remove Passkey on iPhone"');
  });

  test("passkey alamat lain: tampil dengan label alamatnya", () => {
    const out = view(
      { phase: "ready", passkeys: [pk({ usableHere: false, rpId: "localhost" })] },
      true,
    );
    expect(out).toContain("For localhost");
  });

  test("error memuat -> pesan alert", () => {
    const out = view({ phase: "error", message: "Couldn't load passkeys." }, true);
    expect(out).toContain('role="alert"');
    expect(out).toContain("Couldn&#x27;t load passkeys.");
  });
});

describe("Lock screen -> passkey", () => {
  const entry = (over: Partial<Parameters<typeof PasskeyEntry>[0]> = {}) =>
    renderToStaticMarkup(
      <PasskeyEntry
        busy={false}
        disabled={false}
        message={null}
        secretLabel="PIN"
        onUnlock={noop}
        onUseSecret={noop}
        {...over}
      />,
    );

  test("tombol utama + jalan pintas ke PIN", () => {
    const out = entry();
    expect(out).toContain("Unlock with passkey");
    expect(out).toContain("Tap to continue");
    expect(out).toContain("Use PIN instead");
  });

  test("menunggu perangkat: status busy & teks petunjuk", () => {
    const out = entry({ busy: true, disabled: true });
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Confirm on your device");
    expect(out).toContain("Waiting for your passkey");
  });

  test("pesan error tampil di area status (aria-live)", () => {
    const out = entry({ message: "That passkey wasn't accepted." });
    expect(out).toMatch(/aria-live="polite"[^>]*>That passkey wasn&#x27;t accepted\./);
  });
});
