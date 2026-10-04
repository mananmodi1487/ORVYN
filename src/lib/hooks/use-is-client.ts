"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True only after hydration. Backed by `useSyncExternalStore` so the value is
 * `false` during SSR and the hydration render, then `true` afterwards, without
 * scheduling a state update from an effect.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}