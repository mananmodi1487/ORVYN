"use client";

import type { ChatUsage } from "@/lib/ai/chat-protocol";
import { usageCopy } from "@/config/workspace";
import { formatTokens } from "@/lib/ai/usage";
import { cn } from "@/lib/utils";

export type UsageMetaProps = {
  /** `null` when the provider reported nothing for this response. */
  readonly usage: ChatUsage | null;
  readonly className?: string | undefined;
};

/**
 * A single response's provider-reported usage.
 *
 * When the upstream sent no figures this renders "usage unavailable" and stops.
 * There is no estimate and no zero-filling: a response that cannot account for
 * itself is stated as such, because a plausible-looking number would be worse
 * than an honest gap.
 */
export function UsageMeta({ usage, className }: UsageMetaProps) {
  if (usage === null) {
    return (
      <p className={cn("text-[11px] tracking-wide text-ink-subtle", className)}>
        {usageCopy.unavailable}
      </p>
    );
  }

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-ink-subtle tabular-nums",
        className,
      )}
    >
      <span>{`${formatTokens(usage.inputTokens)} ${usageCopy.input}`}</span>
      <span aria-hidden="true" className="text-line-strong">
        ·
      </span>
      <span>{`${formatTokens(usage.outputTokens)} ${usageCopy.output}`}</span>
      <span aria-hidden="true" className="text-line-strong">
        ·
      </span>
      <span className="text-ink-muted">{`${formatTokens(usage.totalTokens)} ${usageCopy.total}`}</span>
    </p>
  );
}