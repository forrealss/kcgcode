/**
 * Lock screen — menutupi seluruh app saat kunci aktif dan sesi belum dibuka.
 *
 * Tampilan ala lock screen: jam & tanggal, foto profil, nickname, lalu input
 * sesuai jenis kunci:
 * - PIN: titik indikator + keypad. Keyboard fisik didengar di level window
 *   (angka baris atas / numpad, Backspace, Enter, Esc) sehingga tidak perlu
 *   klik apa pun dulu. Tombol keypad sengaja tidak menyala saat mengetik
 *   dari keyboard (tidak membocorkan angka saat layar dibagikan). Tempel
 *   (paste) juga didukung. Panjang PIN tidak diketahui klien, jadi dikirim dengan
 *   Enter / tombol ✓.
 * - Password: kartu dengan kolom sandi besar, tombol tampilkan, indikator
 *   Caps Lock, dan tombol "Unlock" penuh.
 * - Passkey: bila alamat ini punya passkey terdaftar & browser mendukung,
 *   tampilan utama berganti jadi satu tombol sidik jari besar. PIN/password
 *   tetap tersedia lewat "Use PIN instead". Dialog sistem tidak dibuka
 *   otomatis — beberapa browser (Safari) mewajibkan ketukan pengguna.
 * Salah -> getar; terlalu banyak percobaan -> hitung mundur dari server.
 *
 * Aksesibilitas: dialog modal (`role="dialog"`, `aria-modal`), status
 * diumumkan lewat `aria-live`.
 *
 * File ini hanya tata letak; state & aksi buka kunci ada di `useUnlock.ts`,
 * tiap jenis input di file sendiri.
 */
import { FingerprintIcon, LockIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/auth/ProfileAvatar";
import { lockLabel } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";
import { PasskeyEntry } from "./PasskeyEntry";
import { PasswordEntry } from "./PasswordEntry";
import { PinEntry } from "./PinEntry";
import { useUnlock } from "./useUnlock";

export function LockScreen({ status }: { status: AuthStatus }) {
  const {
    kind,
    secret,
    busy,
    error,
    shake,
    now,
    blocked,
    message,
    mode,
    passkeyReady,
    passkeyBusy,
    editSecret,
    showSecret,
    showPasskey,
    submit,
    unlockPasskey,
  } = useUnlock(status);

  const time = new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const date = new Date(now).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const name = status.profile.nickname;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      // Animasi masuk/keluar ditangani pembungkus `m.div` di AuthGate.
      className="fixed inset-0 z-[100] flex flex-col items-center overflow-y-auto bg-background"
    >
      {/* Mobile / layar sempit: satu kolom (jam -> profil -> input).
          md+: dua kolom — identitas (jam, tanggal, profil) di kiri, input di
          kanan — sehingga semuanya muat tanpa scroll di layar lebar. */}
      <div
        className={cn(
          "relative flex w-full max-w-sm flex-1 flex-col items-center px-6",
          "pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          "md:my-auto md:max-w-4xl md:flex-none md:grid md:grid-cols-2 md:items-center md:gap-16 md:px-10 md:py-10",
        )}
      >
        {/* ---- Kiri: identitas ---- */}
        {/* Mobile: `mt-auto` di sini + `mt-auto` di petunjuk bawah membagi
            ruang kosong atas & bawah -> blok utama berada di tengah vertikal.
            Bila isi lebih tinggi dari layar, margin jadi 0 dan halaman scroll. */}
        <div className="mt-auto flex flex-col items-center text-center md:mt-0 md:items-start md:text-left">
          <div className="flex flex-col items-center gap-1 md:items-start">
            <p className="text-5xl font-light tabular-nums tracking-tight md:text-7xl">{time}</p>
            <p className="text-sm text-muted-foreground md:text-base">{date}</p>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 md:mt-12 md:flex-row md:gap-4">
            <ProfileAvatar
              nickname={name}
              avatarUrl={status.profile.avatarUrl}
              avatarPreset={status.profile.avatarPreset}
              className="size-20 shadow-lg ring-4 ring-background md:size-16"
              textClassName="text-2xl md:text-xl"
            />
            <div className="flex flex-col items-center gap-0.5 md:items-start">
              <h1 id="lock-title" className="text-xl font-semibold tracking-tight">
                {name ? `Welcome back, ${name}` : "KCG Code is locked"}
              </h1>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {mode === "passkey" ? (
                  <>
                    <FingerprintIcon className="size-3.5" aria-hidden />
                    Use your passkey to unlock
                  </>
                ) : (
                  <>
                    <LockIcon className="size-3.5" aria-hidden />
                    {kind === "pin" ? "Enter your PIN to unlock" : "Enter your password to unlock"}
                  </>
                )}
              </p>
            </div>
          </div>

          <ForgotHint className="mt-12 hidden md:block" />
        </div>

        {/* ---- Kanan: input ---- */}
        <div
          className={cn(
            "mt-7 w-full md:mt-0 md:rounded-3xl md:border md:bg-card/50 md:px-8 md:py-9 md:shadow-sm",
            kind === "password" && "md:py-10",
            shake && "animate-[lock-shake_0.45s]",
          )}
        >
          {mode === "passkey" ? (
            <PasskeyEntry
              busy={passkeyBusy}
              disabled={passkeyBusy || blocked}
              message={message}
              secretLabel={lockLabel(kind)}
              onUnlock={() => void unlockPasskey()}
              onUseSecret={showSecret}
            />
          ) : kind === "pin" ? (
            <PinEntry
              value={secret}
              onChange={editSecret}
              onSubmit={() => void submit(secret)}
              disabled={busy || blocked}
              busy={busy}
              error={shake}
              message={message}
            />
          ) : (
            <PasswordEntry
              value={secret}
              onChange={editSecret}
              onSubmit={() => void submit(secret)}
              disabled={busy || blocked}
              busy={busy}
              message={message}
              invalid={Boolean(error)}
            />
          )}
          {mode === "secret" && passkeyReady && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={showPasskey}
                className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <FingerprintIcon className="size-4" aria-hidden />
                Use passkey instead
              </button>
            </div>
          )}
        </div>

        {/* Mobile: petunjuk lupa kunci di dasar layar; md+: di kolom kiri. */}
        <ForgotHint className="mt-auto pt-8 text-center md:hidden" />
      </div>
    </div>
  );
}

function ForgotHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground/80", className)}>
      Forgot it? Run <code className="font-mono">kcgcode reset-lock</code> on the host machine.
    </p>
  );
}
