/**
 * Welcome screen — render statis langkah pertama.
 */
import { expect, test } from "bun:test";
import { domAnimation, LazyMotion } from "motion/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthStatus } from "@/server/services/auth";
import { WelcomeScreen } from "../WelcomeScreen";

const status: AuthStatus = {
  protected: false,
  authenticated: true,
  lockKind: null,
  autoLockMinutes: 15,
  profile: { nickname: null, avatarUrl: null, avatarPreset: null },
  retryAfterSec: 0,
  needsOnboarding: true,
};

const html = () =>
  renderToStaticMarkup(
    <LazyMotion features={domAnimation} strict>
      <WelcomeScreen status={status} onFinished={() => {}} />
    </LazyMotion>,
  );

test("langkah pertama: dialog berlabel, logo, judul, Get started & Skip", () => {
  const out = html();
  expect(out).toContain('role="dialog"');
  expect(out).toContain('aria-labelledby="welcome-title"');
  expect(out).toContain("Welcome to KCG Code");
  expect(out).toContain("Get started");
  expect(out).toContain("Skip for now");
  // Ringkasan langkah yang akan datang.
  expect(out).toContain("Protect it with a PIN or password");
});

test("langkah pertama tanpa tombol Back & titik progres", () => {
  const out = html();
  expect(out).not.toContain('aria-label="Back"');
  expect(out).not.toContain('aria-label="Setup progress"');
});
