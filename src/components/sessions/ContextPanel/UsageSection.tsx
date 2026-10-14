import { CircleIcon, FoldVerticalIcon, GaugeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatTokens, usageLevel } from "@/lib/context-usage";
import { cn } from "@/lib/utils";
import type { ContextUsage } from "@/types";
import { Box, Row, Section } from "./primitives";

/** Warna isi meter per tingkat pemakaian (AdwLevelBar low/high/full). */
const LEVEL_FILL = {
  normal: "bg-primary",
  warning: "bg-amber-500",
  critical: "bg-destructive",
} as const;

/** Batas kategori rincian yang ditampilkan (terbesar dulu). */
const MAX_CATEGORIES = 4;

export function UsageSection({
  usage,
  live,
  compacting,
  onCompact,
  canCompact,
}: {
  usage: ContextUsage | null;
  live: boolean;
  compacting: boolean;
  onCompact?: () => void;
  canCompact: boolean;
}) {
  const summary =
    usage === null
      ? undefined
      : usage.percent !== null
        ? `${usage.percent}%`
        : `${formatTokens(usage.usedTokens)} tokens`;
  const compactRow = onCompact && (
    <li className="px-2.5 py-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onCompact}
        disabled={!canCompact || compacting}
        title="Summarize the conversation so far to free up context (/compact)"
        className="h-8 w-full rounded-lg text-[12.5px]"
      >
        {compacting ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <FoldVerticalIcon data-icon="inline-start" />
        )}
        {compacting ? "Compacting…" : "Compact conversation"}
      </Button>
    </li>
  );

  return (
    <Section title="Context window" summary={summary}>
      {usage === null ? (
        <Box>
          <Row
            icon={<GaugeIcon />}
            label={
              compacting
                ? "Compacting the conversation…"
                : live
                  ? "Measured after the agent replies"
                  : "Start the session to see usage"
            }
            muted
          />
          {compactRow}
        </Box>
      ) : (
        <Box>
          <UsageMeter usage={usage} />
          {usage.categories.slice(0, MAX_CATEGORIES).map((c) => (
            <Row
              key={c.name}
              icon={<CircleIcon className="!size-2 fill-current" />}
              label={c.name}
              muted
              value={
                <span className="text-[11.5px] text-muted-foreground tabular-nums">
                  {formatTokens(c.tokens)}
                </span>
              }
            />
          ))}
          {compactRow}
        </Box>
      )}
    </Section>
  );
}

/**
 * Meter pemakaian (AdwLevelBar): token terpakai / ukuran window, model, dan
 * garis penanda ambang auto-compact bila diketahui.
 */
function UsageMeter({ usage }: { usage: ContextUsage }) {
  const level = usageLevel(usage.percent);
  const fill = Math.min(100, usage.percent ?? 0);
  const autoAt =
    usage.autoCompactAt !== null && usage.maxTokens
      ? Math.min(100, (usage.autoCompactAt / usage.maxTokens) * 100)
      : null;
  return (
    <li className="flex flex-col gap-1.5 px-2.5 py-2 text-[12.5px]">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate tabular-nums">
          {formatTokens(usage.usedTokens)}
          {usage.maxTokens !== null && (
            <span className="text-muted-foreground">
              {" "}
              of {formatTokens(usage.maxTokens)} tokens
            </span>
          )}
        </span>
        {usage.model && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {usage.model}
          </span>
        )}
      </div>
      {usage.percent !== null && (
        // biome-ignore lint/a11y/useSemanticElements: <meter> native sulit diberi gaya AdwLevelBar lintas browser.
        <div
          role="meter"
          aria-label="Context window usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={fill}
          aria-valuetext={`${usage.percent}% used`}
          className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10"
        >
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300",
              LEVEL_FILL[level],
            )}
            style={{ width: `${fill}%` }}
          />
          {autoAt !== null && (
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-foreground/50"
              style={{ left: `${autoAt}%` }}
            />
          )}
        </div>
      )}
      {usage.autoCompactAt !== null && (
        <span className="text-[11px] text-muted-foreground">
          Auto-compacts at {formatTokens(usage.autoCompactAt)}
        </span>
      )}
    </li>
  );
}
