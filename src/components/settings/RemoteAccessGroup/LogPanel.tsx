import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

/** Log frpc live (polling bertahap `?from=`). */
export function LogPanel({ endpoint = "/api/tunnel/logs" }: { endpoint?: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const next = useRef(0);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await apiFetch(`${endpoint}?from=${next.current}`);
        const body = (await res.json()) as { lines: string[]; next: number };
        if (stop) return;
        next.current = body.next;
        if (body.lines.length > 0) setLines((prev) => [...prev, ...body.lines].slice(-300));
      } catch {
        /* coba lagi di tick berikutnya */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [endpoint]);

  // Ikuti baris terbaru.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll saat baris bertambah
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines.length]);

  return (
    <li className="px-4 py-3">
      <pre
        ref={box}
        role="log"
        aria-label="Connection log"
        className="max-h-56 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all"
      >
        {lines.length === 0 ? "No output yet." : lines.join("\n")}
      </pre>
    </li>
  );
}
