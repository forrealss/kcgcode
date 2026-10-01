/**
 * Alur welcome screen (onboarding) — logika murni, diuji tanpa DOM.
 *
 * Langkah: welcome -> profile -> lock -> done.
 * - `profile` (nickname) boleh dikosongkan.
 * - `lock` boleh dilewati (app tetap terbuka; Settings menampilkan
 *   peringatan seperti biasa).
 */
export const ONBOARDING_STEPS = ["welcome", "profile", "lock", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function nextStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.min(stepIndex(step) + 1, ONBOARDING_STEPS.length - 1)] ?? "done";
}

export function prevStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.max(stepIndex(step) - 1, 0)] ?? "welcome";
}

/** Arah animasi geser saat berpindah langkah (1 maju, -1 mundur). */
export function stepDirection(from: OnboardingStep, to: OnboardingStep): 1 | -1 {
  return stepIndex(to) >= stepIndex(from) ? 1 : -1;
}

/** Langkah yang ditampilkan sebagai titik progres (tanpa layar sambutan/akhir). */
export const PROGRESS_STEPS: readonly OnboardingStep[] = ["profile", "lock"];

/** Sapaan sesuai jam lokal. */
export function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
