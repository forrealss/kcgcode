import { LogView } from "@/components/common/LogView";
import { useIncrementalLog } from "@/hooks/useIncrementalLog";

/** Log frpc live (polling bertahap `?from=`). */
export function LogPanel({ endpoint = "/api/tunnel/logs" }: { endpoint?: string }) {
  const lines = useIncrementalLog(endpoint, { pollMs: 1500 });
  return (
    <li className="px-4 py-3">
      <LogView
        lines={lines}
        aria-label="Connection log"
        emptyText="No output yet."
        className="max-h-56 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all"
      />
    </li>
  );
}
