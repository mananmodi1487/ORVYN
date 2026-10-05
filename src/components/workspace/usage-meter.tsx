"use client";

import { usageCopy } from "@/config/workspace";
import { formatTokens } from "@/lib/ai/usage";
import type { UseAccountUsage } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export type UsageMeterProps = {
  usage: UseAccountUsage;
  collapsed: boolean;
};

/**
 * The account's daily usage and ORVYN's free-pool position.
 *
 * Every figure here came from a provider response recorded server-side. When
 * there is no store or no signed-in user the component says so rather than
 * showing zero — a zero would read as "you have used nothing", which is a claim
 * ORVYN cannot make on the user's behalf.
 *
 * The pool figure is deliberately labelled as ORVYN's own target. Providers do
 * not promise that capacity, and implying otherwise would turn a budget into a
 * promise.
 */
export function UsageMeter({ usage, collapsed }: UsageMeterProps) {
  if (collapsed) {
    return (
      <div className="hidden justify-center py-1 lg:flex" title={usageCopy.pool}>
        <PoolBar ratio={poolRatio(usage)} />
      </div>
    );
  }

  const today = usage.summary?.userDaily ?? null;
  const month = usage.summary?.globalMonth ?? null;
  const target = usage.summary?.monthlyTargetTokens ?? null;

  return (
    <div className="rounded-lg border border-line px-3 py-3">
      <p className="text-[11px] font-medium tracking-[0.08em] text-ink-subtle uppercase">
        {usageCopy.today}
      </p>
      <p className="mt-1.5 font-mono text-sm text-ink tabular-nums">
        {today === null ? usageCopy.unavailable : `${formatTokens(today.totalTokens)} tokens`}
      </p>

      <div className="mt-3.5 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium tracking-[0.08em] text-ink-subtle uppercase">
            {usageCopy.pool}
          </p>
          <p className="font-mono text-[11px] text-ink-muted tabular-nums">
            {month === null
              ? "—"
              : `${formatTokens(month.totalTokens)}${target === null ? "" : ` / ${formatTokens(target)}`}`}
          </p>
        </div>

        <div className="mt-2">
          <PoolBar ratio={poolRatio(usage)} />
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
          {month === null ? usageCopy.unavailablePool : usageCopy.poolNote}
        </p>
      </div>
    </div>
  );
}

/**
 * Share of ORVYN's monthly target consumed, clamped to 0..1.
 *
 * `null` when either side is unknown, which renders as an empty track rather
 * than an empty-looking bar that would imply zero progress.
 */
function poolRatio(usage: UseAccountUsage): number | null {
  const month = usage.summary?.globalMonth ?? null;
  const target = usage.summary?.monthlyTargetTokens ?? null;
  if (month === null || target === null || target <= 0) return null;
  return Math.min(Math.max(month.totalTokens / target, 0), 1);
}

function PoolBar({ ratio }: { readonly ratio: number | null }) {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-line"
      role="presentation"
      aria-hidden="true"
    >
      <div
        className={cn(
          "h-full rounded-full bg-ink-subtle transition-[width] duration-300",
          ratio === null && "w-0",
        )}
        style={ratio === null ? undefined : { width: `${ratio * 100}%` }}
      />
    </div>
  );
}