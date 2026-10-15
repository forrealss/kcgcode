/** Welcome screen, langkah 4: ringkasan singkat, lalu masuk ke app. */
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import * as m from "motion/react-m";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedFocus } from "@/hooks/useDelayedFocus";
import { lockLabel } from "@/lib/auth";
import type { LockKind } from "@/lib/lock-secret";
import { cn } from "@/lib/utils";
import { EASE, Stagger } from "./primitives";

export function DoneStep({
  nickname,
  lockSet,
  finishing,
  onFinish,
}: {
  nickname: string | null;
  lockSet: LockKind | null;
  finishing: boolean;
  onFinish: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useDelayedFocus(btnRef, 450, { preventScroll: true });

  return (
    <div className="flex flex-col items-center text-center">
      {/* Centang: lingkaran membesar lalu garis centang tergambar. */}
      <m.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{
          scale: 1,
          opacity: 1,
          transition: { type: "spring", stiffness: 280, damping: 18 },
        }}
        className="flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        <svg viewBox="0 0 24 24" className="size-10" fill="none" aria-hidden="true">
          <m.path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1, transition: { delay: 0.2, duration: 0.45, ease: EASE } }}
          />
        </svg>
      </m.span>

      <Stagger i={1}>
        <h1 id="welcome-title" className="mt-7 text-2xl font-semibold tracking-tight">
          {nickname ? `You're all set, ${nickname}` : "You're all set"}
        </h1>
      </Stagger>
      <Stagger i={2}>
        <ul className="mt-6 flex flex-col gap-2.5 text-left text-[14px]">
          <SummaryRow
            ok
            text={nickname ? `Name set to ${nickname}` : "Name skipped"}
            muted={!nickname}
          />
          <SummaryRow
            ok={lockSet !== null}
            text={
              lockSet
                ? `Protected with a ${lockLabel(lockSet)}`
                : "No lock yet. You can add one in Settings → Security."
            }
            muted={lockSet === null}
          />
        </ul>
      </Stagger>
      <Stagger i={3}>
        <Button
          ref={btnRef}
          type="button"
          onClick={onFinish}
          disabled={finishing}
          className="mt-10 h-12 w-64 max-w-full rounded-full text-[15px]"
        >
          {finishing ? <Spinner data-icon="inline-start" /> : null}
          Open KCG Code
          {!finishing && <ArrowRightIcon data-icon="inline-end" />}
        </Button>
      </Stagger>
    </div>
  );
}

function SummaryRow({ ok, text, muted }: { ok: boolean; text: string; muted?: boolean }) {
  return (
    <li className={cn("flex items-start gap-2.5", muted && "text-muted-foreground")}>
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          ok && !muted ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted",
        )}
      >
        {ok && !muted ? (
          <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
        )}
      </span>
      {text}
    </li>
  );
}
