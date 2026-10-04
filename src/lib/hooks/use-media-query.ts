"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. Uses `useSyncExternalStore` so the value is
 * read during SSR and hydration without a client-only rendering pass.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
