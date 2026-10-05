"use client";

import { useEffect, useState } from "react";
import type { UsageSummary } from "@/lib/ai/usage-store";

/**
 * The signed-in user's daily usage and the global free pool.
 *
 * `summary` stays `null` until the request resolves so the UI can show nothing
 * rather than a zero, and `unavailable` distinguishes "no store" from "zero
 * tokens used". A failed fetch is not silently zero: an error means ORVYN does
 * not know, and reporting 0 would be a claim it cannot support.
 */
export type UseAccountUsage = {
  readonly summary: UsageSummary | null;
  /** True while the first fetch is in flight. */
  readonly loading: boolean;
  /** True when the store could not be read at all. */
  readonly unavailable: boolean;
};

const USAGE_ENDPOINT = "/api/usage";

/**
 * @param refreshKey Changing this value refetches. Callers pass something that
 *   changes when new usage could have been recorded — the turn count — so the
 *   pool figures stay in step with the transcript without polling.
 */
export function useAccountUsage(refreshKey?: unknown): UseAccountUsage {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch(USAGE_ENDPOINT, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = (await response.json()) as UsageSummary;
        if (!active) return;
        setSummary(parsed);
        // A well-formed reply whose figures are all absent is still "the store
        // answered", so only a failed request counts as unavailable here.
        setUnavailable(false);
      } catch {
        if (!active) return;
        setUnavailable(true);
      }
    })();

    return () => {
      // Guard against a late response landing after unmount or after a newer
      // fetch started.
      active = false;
    };
  }, [refreshKey]);

  // Derived rather than stored: a refetch that keeps the previous summary on
  // screen is not a loading state, it is a refresh. Avoiding a `loading` flag
  // also keeps a stale-but-true figure visible instead of blanking it.
  return { summary, loading: summary === null && !unavailable, unavailable };
}