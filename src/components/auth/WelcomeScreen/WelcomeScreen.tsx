/**
 * Welcome screen untuk instalasi baru (`AuthStatus.needsOnboarding`).
 *
 * Alur (lihat `lib/onboarding.ts`):
 * 1. Welcome — logo + nama app + tagline, tombol "Get started".
 * 2. Profile — nickname (opsional).
 * 3. Lock — pasang PIN/password (direkomendasikan, bisa dilewati).
 * 4. Done — ringkasan singkat, lalu masuk ke app.
 *
 * Animasi (Motion, otomatis lebih sederhana bila prefers-reduced-motion —
 * `MotionConfig reducedMotion="user"` di App):
 * - Masuk: logo "mendarat" dengan pegas lembut, teks muncul bertahap.
 * - Antar langkah: geser + pudar searah navigasi (maju ke kiri, mundur ke
 *   kanan), tinggi kartu tidak melompat karena konten ditumpuk satu per satu
 *   dengan `mode="wait"` dan durasi pendek.
 * - Keluar: seluruh layar memudar & sedikit membesar, app di bawahnya
 *   (dirender `AuthGate`) muncul dari baliknya.
 *
 * Gaya mengikuti halaman lain (libadwaita): kartu boxed list, tombol pil.
 *
 * File ini mengatur perpindahan langkah; tiap langkah ada di file sendiri.
 */
import { ArrowLeftIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { refreshAuth } from "@/lib/auth";
import type { LockKind } from "@/lib/lock-secret";
import { nextStep, type OnboardingStep, prevStep, stepDirection } from "@/lib/onboarding";
import type { AuthStatus } from "@/server/services/auth";
import { DoneStep } from "./DoneStep";
import { LockStep } from "./LockStep";
import { ProfileStep } from "./ProfileStep";
import { EASE, StepDots } from "./primitives";
import { WelcomeStep } from "./WelcomeStep";

export function WelcomeScreen({
  status,
  onFinished,
}: {
  status: AuthStatus;
  /** Dipanggil setelah onboarding ditandai selesai — AuthGate membuka app. */
  onFinished: () => void;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [dir, setDir] = useState<1 | -1>(1);
  const [nickname, setNickname] = useState(status.profile.nickname ?? "");
  /** Hasil langkah kunci: jenis kunci yang dipasang, atau null = dilewati. */
  const [lockSet, setLockSet] = useState<LockKind | null>(null);
  const [finishing, setFinishing] = useState(false);

  const go = (to: OnboardingStep) => {
    setDir(stepDirection(step, to));
    setStep(to);
  };

  /** Selesai: tandai di server, muat ulang status, lalu AuthGate membuka app. */
  const finish = async () => {
    setFinishing(true);
    try {
      await apiFetch("/api/auth/onboarding/complete", { method: "POST" });
    } catch {
      // Gagal menandai tidak boleh mengurung pengguna di welcome screen.
    }
    await refreshAuth();
    onFinished();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="fixed inset-0 z-[90] flex flex-col overflow-y-auto bg-background"
    >
      {/* Cahaya lembut di atas (satu aksen, sama dengan halaman About). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[60dvh] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(109,92,251,0.10),transparent_70%)] dark:bg-[radial-gradient(60%_50%_at_50%_0%,rgba(109,92,251,0.18),transparent_70%)]"
      />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/* Progres: hanya untuk langkah pengaturan. */}
        <div className="flex h-8 items-center justify-between">
          {step !== "welcome" && step !== "done" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => go(prevStep(step))}
              aria-label="Back"
              className="-ml-2 size-9 rounded-full"
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
          ) : (
            <span />
          )}
          <StepDots step={step} />
          <span className="size-9" />
        </div>

        <div className="flex flex-1 flex-col justify-center py-6">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <m.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 28 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.32, ease: EASE } }}
              exit={{ opacity: 0, x: dir * -28, transition: { duration: 0.18, ease: "easeIn" } }}
            >
              {step === "welcome" && (
                <WelcomeStep
                  onStart={() => go("profile")}
                  onSkip={() => void finish()}
                  finishing={finishing}
                />
              )}
              {step === "profile" && (
                <ProfileStep
                  value={nickname}
                  onChange={setNickname}
                  onNext={() => go(nextStep("profile"))}
                />
              )}
              {step === "lock" && (
                <LockStep
                  onDone={(kind) => {
                    setLockSet(kind);
                    go("done");
                  }}
                />
              )}
              {step === "done" && (
                <DoneStep
                  nickname={nickname.trim() || null}
                  lockSet={lockSet}
                  finishing={finishing}
                  onFinish={() => void finish()}
                />
              )}
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
