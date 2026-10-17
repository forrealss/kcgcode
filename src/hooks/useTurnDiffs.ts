/**
 * Perubahan file per turn milik Session: dimuat sekali, lalu bertambah
 * realtime lewat WS `turn_diff`. `forGroup` mencocokkan diff dengan grup
 * turn assistant di timeline lewat id pesannya.
 */
import { useCallback, useEffect, useState } from "react";
import { getTurnDiffs } from "@/lib/changes-api";
import { onTurnDiff } from "@/lib/changes-events";
import type { SessionMessage, TurnDiff } from "@/types";

export function useTurnDiffs(sessionId: string) {
  const [diffs, setDiffs] = useState<TurnDiff[]>([]);

  useEffect(() => {
    let cancelled = false;
    setDiffs([]);
    void getTurnDiffs(sessionId).then(
      (list) => {
        if (!cancelled)
          setDiffs((cur) => [...list, ...cur.filter((d) => !list.some((x) => x.id === d.id))]);
      },
      () => {},
    );
    const off = onTurnDiff((d) => {
      if (d.sessionId === sessionId)
        setDiffs((cur) => (cur.some((x) => x.id === d.id) ? cur : [...cur, d]));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId]);

  /** Diff milik grup turn (pesan pertama turn berada di grup ini). */
  const forGroup = useCallback(
    (messages: readonly SessionMessage[]): TurnDiff | null => {
      for (let i = diffs.length - 1; i >= 0; i--) {
        const d = diffs[i];
        if (d?.messageId && messages.some((m) => m.id === d.messageId)) return d;
      }
      return null;
    },
    [diffs],
  );

  return { diffs, forGroup };
}
