/** Primitif tampilan bersama langkah-langkah welcome screen. */
import type { UserRoundIcon } from "lucide-react";
import * as m from "motion/react-m";
import { type OnboardingStep, PROGRESS_STEPS } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/** Kurva "mendarat halus" yang sama dengan animasi lain di app. */
export const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

export function StepDots({ step }: { step: OnboardingStep }) {
  if (step === "welcome" || step === "done") return <span />;
  const current = PROGRESS_STEPS.indexOf(step);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Setup progress">
      {PROGRESS_STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i === current
              ? "w-6 bg-primary"
              : i < current
                ? "w-1.5 bg-primary/50"
                : "w-1.5 bg-muted",
          )}
        >
          <span className="sr-only">
            Step {i + 1} of {PROGRESS_STEPS.length}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Teks bertahap: tiap anak muncul sedikit setelah yang sebelumnya. */
export function Stagger({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: 0.15 + i * 0.08, duration: 0.4, ease: EASE },
      }}
    >
      {children}
    </m.div>
  );
}

export function StepHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof UserRoundIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-7" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 id="welcome-title" className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="max-w-xs text-[14px] leading-snug text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
