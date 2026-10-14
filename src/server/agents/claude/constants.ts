/** Konstanta adapter Claude Code (timeout, cache, permission mode, effort). */
import type { PermissionModeOption } from "../../../types";

/** `providerID` model Claude Code di `SessionModel` / pemilih model. */
export const CLAUDE_PROVIDER_ID = "claude-code";
/** Proses `claude` yang idle selama ini ditutup (prompt berikutnya resume). */
export const CLAUDE_IDLE_CLOSE_MS = 10 * 60_000;
/** Batas tunggu request kontrol SDK (daftar model, status MCP, interrupt). */
export const CONTROL_TIMEOUT_MS = 30_000;
/** Pemakaian konteks diukur ulang paling sering sekali per jendela ini. */
export const USAGE_REFRESH_MS = 10_000;
/** Cache daftar model & slash command (spawn proses hanya untuk daftar itu mahal). */
export const MODELS_CACHE_MS = 5 * 60_000;
/** Cache daftar file Project untuk autocomplete `@file`. */
export const FILES_CACHE_MS = 10_000;
/** Baris stderr terakhir yang disimpan untuk pesan error crash. */
export const STDERR_TAIL_LINES = 20;

/**
 * Permission mode Claude Code (`PermissionMode` SDK). Session tanpa pilihan
 * (`null`) mengikuti `permissions.defaultMode` di settings user.
 */
export const CLAUDE_PERMISSION_MODES: PermissionModeOption[] = [
  {
    id: "default",
    label: "Ask before acting",
    description: "Asks before edits and commands",
  },
  {
    id: "acceptEdits",
    label: "Accept edits",
    description: "Auto-approves file edits; still asks for commands",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only: researches and proposes a plan for your approval",
  },
  {
    id: "auto",
    label: "Auto",
    description: "A classifier approves safe actions and asks about the rest",
  },
  {
    id: "dontAsk",
    label: "Don't ask",
    description: "Never asks — anything not pre-approved is denied",
  },
  {
    id: "bypassPermissions",
    label: "Bypass permissions",
    description: "Runs every tool without asking. Use only in a sandbox",
    dangerous: true,
  },
];

export const PERMISSION_MODE_IDS = new Set(CLAUDE_PERMISSION_MODES.map((m) => m.id));

/** Tingkat effort Claude Code (`EffortLevel` SDK); nilai lain diabaikan. */
export const EFFORT_LEVELS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);

/** Prompt `/compact [instruksi]` = compact manual. */
export const COMPACT_PROMPT = /^\/compact(?:\s|$)/;
