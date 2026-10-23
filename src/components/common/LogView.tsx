/**
 * Blok log monospace (`<pre role="log">`) yang mengikuti baris terbaru —
 * log tunnel di Settings dan log dev server di sheet Preview.
 */
import { useEffect, useRef } from "react";

export interface LogViewProps {
  lines: string[];
  className?: string;
  "aria-label"?: string;
  /** Teks saat belum ada baris (tanpa ini blok kosong). */
  emptyText?: string;
}

export function LogView({ lines, className, "aria-label": label, emptyText }: LogViewProps) {
  const ref = useRef<HTMLPreElement>(null);
  // Ikuti baris terbaru.
  useEffect(() => {
    const el = ref.current;
    if (el && lines.length > 0) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <pre ref={ref} role="log" aria-label={label} className={className}>
      {lines.length === 0 && emptyText !== undefined ? emptyText : lines.join("\n")}
    </pre>
  );
}
