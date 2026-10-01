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
 */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  LockIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserRoundIcon,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { refreshAuth } from "@/lib/auth";
import {
  greeting,
  nextStep,
  type OnboardingStep,
  PROGRESS_STEPS,
  prevStep,
  stepDirection,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import type { AuthStatus } from "@/server/services/auth";
import logo from "../../logo.svg";

type LockKind = "pin" | "password";

/** Kurva "mendarat halus" yang sama dengan animasi lain di app. */
const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

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

function StepDots({ step }: { step: OnboardingStep }) {
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

// ---------------------------------------------------------------- langkah ----

/** Teks bertahap: tiap anak muncul sedikit setelah yang sebelumnya. */
function Stagger({ i, children }: { i: number; children: React.ReactNode }) {
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

function WelcomeStep({
  onStart,
  onSkip,
  finishing,
}: {
  onStart: () => void;
  onSkip: () => void;
  finishing: boolean;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setTimeout(() => startRef.current?.focus({ preventScroll: true }), 400);
    return () => clearTimeout(t);
  }, []);

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

function StepHeader({
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

function ProfileStep({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 350);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname: value.trim() || null }),
      });
      onNext();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your name.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <StepHeader
        icon={UserRoundIcon}
        title="What should we call you?"
        description="Your name appears on the lock screen and in the sidebar. You can change it later."
      />

      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs focus-within:ring-[3px] focus-within:ring-ring/30">
          <div className="flex flex-col px-4 py-2.5">
            <label htmlFor={id} className="text-[12px] leading-4 text-muted-foreground">
              Nickname
            </label>
            <input
              ref={inputRef}
              id={id}
              value={value}
              maxLength={40}
              autoComplete="nickname"
              placeholder="e.g. Irsyad"
              onChange={(e) => {
                onChange(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              // 16px di HP: iOS tidak men-zoom saat fokus.
              className="h-8 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60 sm:text-[15px]"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <Button type="submit" disabled={saving} className="h-12 rounded-full text-[15px]">
        {saving && <Spinner data-icon="inline-start" />}
        {value.trim() ? "Continue" : "Skip"}
        {!saving && <ArrowRightIcon data-icon="inline-end" />}
      </Button>
    </form>
  );
}

function LockStep({ onDone }: { onDone: (kind: LockKind | null) => void }) {
  const [kind, setKind] = useState<LockKind>("pin");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secretId = useId();
  const confirmId = useId();
  const secretRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => secretRef.current?.focus({ preventScroll: true }), 350);
    return () => clearTimeout(t);
  }, []);

  const label = kind === "pin" ? "PIN" : "password";
  const hint =
    kind === "pin"
      ? "6–12 digits. Avoid repeated or sequential digits."
      : "At least 8 characters. A short phrase works well.";

  const clean = (v: string) => (kind === "pin" ? v.replace(/\D/g, "") : v);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kind === "pin" && (secret.length < 6 || secret.length > 12)) {
      setError("PIN must be 6–12 digits.");
      return;
    }
    if (kind === "password" && secret.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (secret !== confirm) {
      setError(`The ${label}s don't match.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/lock", { method: "PUT", body: JSON.stringify({ kind, secret }) });
      onDone(kind);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the lock.");
    } finally {
      setBusy(false);
    }
  };

  const field = (
    id: string,
    title: string,
    value: string,
    set: (v: string) => void,
    ref?: React.Ref<HTMLInputElement>,
  ) => (
    <div className="flex flex-col px-4 py-2.5 focus-within:bg-muted/30">
      <label htmlFor={id} className="text-[12px] leading-4 text-muted-foreground">
        {title}
      </label>
      <input
        ref={ref}
        id={id}
        type="password"
        inputMode={kind === "pin" ? "numeric" : undefined}
        autoComplete="new-password"
        maxLength={kind === "pin" ? 12 : 128}
        value={value}
        disabled={busy}
        onChange={(e) => {
          set(clean(e.target.value));
          setError(null);
        }}
        className={cn(
          "h-8 w-full bg-transparent text-base outline-none sm:text-[15px]",
          kind === "pin" && "tracking-[0.3em]",
        )}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-7">
      <StepHeader
        icon={ShieldCheckIcon}
        title="Lock your workspace"
        description="Anyone who can open this page can control your agents. A lock keeps it yours, especially when you use Remote access."
      />

      {/* Segmented control ala GNOME (sama dengan dialog di Settings). */}
      <fieldset
        aria-label="Lock type"
        className="grid grid-cols-2 gap-1 rounded-lg border-0 bg-muted p-1"
      >
        {(["pin", "password"] as const).map((k) => (
          <label
            key={k}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              kind === k
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="welcome-lock-kind"
              value={k}
              checked={kind === k}
              onChange={() => {
                setKind(k);
                setSecret("");
                setConfirm("");
                setError(null);
              }}
              className="sr-only"
            />
            {k === "pin" ? "PIN" : "Password"}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-col divide-y">
            {field(secretId, `New ${label}`, secret, setSecret, secretRef)}
            {field(confirmId, `Confirm ${label}`, confirm, setConfirm)}
          </div>
        </div>
        <p className="px-1 text-[12px] text-muted-foreground">{hint}</p>
        {error && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          disabled={busy || secret === "" || confirm === ""}
          className="h-12 rounded-full text-[15px]"
        >
          {busy ? <Spinner data-icon="inline-start" /> : <LockIcon data-icon="inline-start" />}
          Turn on lock
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => onDone(null)}
          className="h-10 rounded-full text-muted-foreground"
        >
          Skip, I'll do it later
        </Button>
      </div>
    </form>
  );
}

function DoneStep({
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
  useEffect(() => {
    const t = setTimeout(() => btnRef.current?.focus({ preventScroll: true }), 450);
    return () => clearTimeout(t);
  }, []);

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
                ? `Protected with a ${lockSet === "pin" ? "PIN" : "password"}`
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
