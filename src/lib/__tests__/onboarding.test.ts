import { describe, expect, test } from "bun:test";
import {
  greeting,
  nextStep,
  ONBOARDING_STEPS,
  PROGRESS_STEPS,
  prevStep,
  stepDirection,
} from "../onboarding";

describe("alur onboarding", () => {
  test("urutan langkah welcome -> profile -> lock -> done", () => {
    expect([...ONBOARDING_STEPS]).toEqual(["welcome", "profile", "lock", "done"]);
    expect(nextStep("welcome")).toBe("profile");
    expect(nextStep("profile")).toBe("lock");
    expect(nextStep("lock")).toBe("done");
    expect(nextStep("done")).toBe("done");
  });

  test("mundur berhenti di welcome", () => {
    expect(prevStep("lock")).toBe("profile");
    expect(prevStep("profile")).toBe("welcome");
    expect(prevStep("welcome")).toBe("welcome");
  });

  test("arah animasi mengikuti navigasi", () => {
    expect(stepDirection("welcome", "profile")).toBe(1);
    expect(stepDirection("lock", "profile")).toBe(-1);
  });

  test("titik progres hanya untuk langkah pengaturan", () => {
    expect([...PROGRESS_STEPS]).toEqual(["profile", "lock"]);
  });

  test("sapaan sesuai jam", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
    expect(greeting(2)).toBe("Good evening");
  });
});
