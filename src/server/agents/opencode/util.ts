/** Helper parsing respons longgar `@opencode/client`, direktori, dan error. */
import path from "node:path";
import type { Result, SimpleResult } from "../../result";

export type Rec = Record<string, unknown>;

export function rec(v: unknown): Rec {
  return typeof v === "object" && v !== null ? (v as Rec) : {};
}

export function list(v: unknown): unknown[] {
  const data = rec(v).data;
  return Array.isArray(data) ? data : Array.isArray(v) ? v : [];
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Kunci perbandingan direktori (Windows tidak case-sensitive). */
export function directoryKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Nama error tag client v2 (`SessionNotFoundError`, …). */
export function errorName(e: unknown): string {
  const err = e as { _tag?: unknown; name?: unknown };
  return typeof err?._tag === "string" ? err._tag : typeof err?.name === "string" ? err.name : "";
}

export function errorMessage(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

/** `Result<T>` -> `SimpleResult` (data dibuang). */
export const ok = <T>(r: Result<T>): SimpleResult =>
  r.ok ? { ok: true } : { ok: false, error: r.error };

/** `/nama args` di awal teks -> nama + argumen; selain itu null. */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([^\s/][^\s]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: m[1] as string, args: (m[2] ?? "").trim() } : null;
}
