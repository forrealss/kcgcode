/**
 * Tangkap error console sedini mungkin (sebelum script app berjalan):
 * `console.error`, error global & gagal muat resource, dan promise rejection
 * yang tidak ditangani.
 */
import { recordError } from "./state";

function stringify(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function captureConsoleErrors(): void {
  const origError = console.error;
  console.error = function (this: unknown, ...args: unknown[]) {
    try {
      const [first, ...rest] = args;
      const detail = args.find((a) => a instanceof Error) as Error | undefined;
      recordError(
        [first, ...rest].map(stringify).join(" ").split("\n")[0] ?? "",
        detail?.stack ?? "",
      );
    } catch {
      // jangan pernah merusak console.error asli
    }
    return origError.apply(this, args);
  };
  window.addEventListener(
    "error",
    (e) => {
      const target = e.target as (HTMLElement & { src?: string; href?: string }) | null;
      if (target && target !== (window as unknown) && "tagName" in target) {
        recordError(
          `Failed to load ${target.tagName.toLowerCase()}: ${target.src ?? target.href ?? ""}`,
        );
        return;
      }
      const err = (e as ErrorEvent).error;
      recordError(
        (e as ErrorEvent).message || stringify(err),
        err instanceof Error
          ? (err.stack ?? "")
          : `${(e as ErrorEvent).filename}:${(e as ErrorEvent).lineno}`,
      );
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    recordError(
      `Unhandled rejection: ${r instanceof Error ? r.message : stringify(r)}`,
      r?.stack ?? "",
    );
  });
}
