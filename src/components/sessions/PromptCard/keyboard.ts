/**
 * Util pintasan keyboard kartu prompt (listener di level window).
 */

/**
 * Event berasal dari kolom isian (composer / input lain) — pintasan kartu
 * diabaikan agar mengetik tidak menjawab prompt tanpa sengaja.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
  );
}
