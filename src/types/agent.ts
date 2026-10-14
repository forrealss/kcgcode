/**
 * Tipe tampilan agent (dipakai server & UI) — daftar model, mode/agent,
 * skill, dan MCP sebuah Project. Netral terhadap backend: opencode maupun
 * Claude Code memetakan datanya ke bentuk ini di adapter masing-masing
 * (`src/server/agents/*`).
 */
import type { McpServerState } from "./context";

/** Satu model yang tersedia pada sebuah provider. */
export interface ModelOption {
  providerID: string;
  providerName: string;
  modelID: string;
  /** Nama tampilan (fallback: modelID). */
  name: string;
  /**
   * Tingkat thinking effort yang didukung, urut dari terendah (Claude Code
   * `supportedEffortLevels`, variant model opencode). Kosong/tidak ada =
   * model tanpa pilihan effort.
   */
  efforts?: string[];
  /** Model yang dipakai Session tanpa pilihan model (default agent). */
  isDefault?: boolean;
}

/** Satu agent (mode percakapan) yang bisa dipilih di composer. */
export interface AgentOption {
  /** Id agent — nilai yang disimpan di Session dan dikirim ke backend. */
  name: string;
  mode: "primary" | "subagent" | "all";
  description: string | null;
}

/** Satu MCP server Project beserta status koneksinya. */
export type McpServerInfo = McpServerState;

/** Status koneksi MCP server. */
export type McpStatus = McpServerState["status"];

/** Asal sebuah skill: bawaan agent, folder Project, atau global user. */
export type SkillSource = "builtin" | "project" | "global";

/** Satu skill yang terdaftar (tanpa isi SKILL.md). */
export interface SkillInfo {
  name: string;
  description: string | null;
  /** Path SKILL.md; null untuk skill bawaan. */
  location: string | null;
  source: SkillSource;
}

/** Satu permission mode yang ditawarkan agent (mis. Claude Code `plan`). */
export interface PermissionModeOption {
  /** Id mode — nilai `Session.permissionMode`. */
  id: string;
  label: string;
  description: string;
  /** Mode berisiko (mis. melewati semua izin) — UI meminta konfirmasi. */
  dangerous?: boolean;
}

/** Fitur khas agent yang perlu diketahui UI (`GET /api/projects/:id/capabilities`). */
export interface AgentCapabilitiesInfo {
  /** Permission mode yang bisa dipilih; kosong = agent tidak punya konsep ini. */
  permissionModes: PermissionModeOption[];
}
