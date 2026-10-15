import { expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  describeExternalSummary,
  externalBusyLabel,
  externalSourceLabel,
  mergeExternalSessions,
} from "@/lib/external-sessions";
import type { ExternalSession } from "@/types";

const base = { updatedAt: 1, openElsewhere: false };
const flaky: ExternalSession = { ...base, id: "a", title: "Fix flaky test", gitBranch: "main" };

test("externalSourceLabel", () => {
  expect(externalSourceLabel({ ...flaky, source: "claude-desktop" })).toBe("Claude Desktop");
  expect(externalSourceLabel({ ...flaky, source: "cli" })).toBe("Claude Code CLI");
  expect(externalSourceLabel({ ...flaky, source: "opencode" })).toBe("OpenCode");
  expect(externalSourceLabel(flaky)).toBe("Claude Code");
});

test("externalBusyLabel: Claude terbuka di aplikasi lain, opencode sedang membalas", () => {
  const busy = { ...flaky, openElsewhere: true };
  expect(externalBusyLabel({ ...busy, source: "cli", agentType: "claude-code" })).toBe(
    "Open in Claude Code CLI",
  );
  expect(externalBusyLabel({ ...busy, source: "opencode", agentType: "opencode" })).toBe(
    "Running in OpenCode",
  );
});

test("mergeExternalSessions: gabung terbaru dulu, agent tidak tersedia dilewati", () => {
  const load = mergeExternalSessions([
    {
      agentType: "opencode",
      sessions: [
        { ...base, id: "ses_1", title: "oc old", updatedAt: 10, source: "opencode" },
        { ...base, id: "ses_2", title: "oc new", updatedAt: 30, source: "opencode" },
      ],
    },
    { agentType: "claude-code", sessions: [{ ...flaky, updatedAt: 20 }] },
  ]);
  expect(load.sessions.map((s) => [s.agentType, s.id])).toEqual([
    ["opencode", "ses_2"],
    ["claude-code", "a"],
    ["opencode", "ses_1"],
  ]);
  expect(load.agents).toEqual(["opencode", "claude-code"]);
  expect(load.errors).toEqual([]);

  const unavailable = (code: string) => new ApiError(503, code, code);
  for (const code of [
    "UNSUPPORTED_AGENT_TYPE",
    "EXTERNAL_SESSIONS_UNSUPPORTED",
    "OPENCODE_NOT_FOUND",
    "OPENCODE_UPGRADE_REQUIRED: 1.4.0",
  ]) {
    const only = mergeExternalSessions([
      { agentType: "opencode", error: unavailable(code) },
      { agentType: "claude-code", sessions: [flaky] },
    ]);
    expect(only.agents).toEqual(["claude-code"]);
    expect(only.errors).toEqual([]);
  }
});

test("mergeExternalSessions: kegagalan lain menjadi error per agent", () => {
  const load = mergeExternalSessions([
    {
      agentType: "opencode",
      error: new ApiError(502, "SERVER_START_FAILED", "Failed to connect."),
    },
    { agentType: "claude-code", error: new Error("network") },
  ]);
  expect(load.sessions).toEqual([]);
  expect(load.agents).toEqual(["opencode", "claude-code"]);
  expect(load.errors).toEqual([
    { agentType: "opencode", message: "Failed to connect." },
    { agentType: "claude-code", message: "Failed to load Claude Code sessions" },
  ]);
});

test("describeExternalSummary: jumlah + yang masih terbuka di aplikasi lain", () => {
  expect(describeExternalSummary([flaky])).toBe("1 session");
  expect(describeExternalSummary([flaky, { ...flaky, id: "b", openElsewhere: true }])).toBe(
    "2 sessions · 1 open elsewhere",
  );
});
