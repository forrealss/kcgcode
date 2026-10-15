/** Welcome screen, langkah 1: logo + nama app + tagline, "Get started" / "Skip". */
import { ArrowRightIcon, LockIcon, SparklesIcon, UserRoundIcon } from "lucide-react";
import * as m from "motion/react-m";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedFocus } from "@/hooks/useDelayedFocus";
import { greeting } from "@/lib/onboarding";
import logo from "../../../logo.svg";
import { Stagger } from "./primitives";

export function WelcomeStep({
  onStart,
  onSkip,
  finishing,
}: {
  onStart: () => void;
  onSkip: () => void;
  finishing: boolean;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  useDelayedFocus(startRef, 400, { preventScroll: true });

  return (
    <div className="flex flex-col items-center text-center">
      <m.span
        initial={{ opacity: 0, scale: 0.8, y: 12 }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { type: "spring", stiffness: 260, damping: 22 },
        }}
        className="flex size-24 items-center justify-center rounded-[1.75rem] border bg-card p-5 shadow-sm sm:size-28"
      >
        <img src={logo} alt="" className="size-full" />
      </m.span>

      <Stagger i={0}>
        <p className="mt-8 text-sm font-medium text-muted-foreground">
          {greeting(new Date().getHours())}
        </p>
      </Stagger>
      <Stagger i={1}>
        <h1 id="welcome-title" className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          Welcome to KCG Code
        </h1>
      </Stagger>
      <Stagger i={2}>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-pretty text-muted-foreground">
          Run your AI coding agents from any device. Let's get you set up. It takes less than a
          minute.
        </p>
      </Stagger>

      <Stagger i={3}>
        <ul className="mt-8 flex flex-col gap-3 text-left">
          {[
            { icon: UserRoundIcon, text: "Pick a name for this workspace" },
            { icon: LockIcon, text: "Protect it with a PIN or password" },
            { icon: SparklesIcon, text: "Start your first session" },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-[14px]">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </Stagger>

      <Stagger i={4}>
        <div className="mt-10 flex w-full flex-col items-center gap-2">
          <Button
            ref={startRef}
            type="button"
            onClick={onStart}
            className="h-12 w-64 max-w-full rounded-full text-[15px]"
          >
            Get started
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            disabled={finishing}
            className="h-10 rounded-full text-muted-foreground"
          >
            {finishing && <Spinner data-icon="inline-start" />}
            Skip for now
          </Button>
        </div>
      </Stagger>
    </div>
  );
}
