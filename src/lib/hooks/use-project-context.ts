"use client";

import { useCallback, useState } from "react";
import {
  detectLocalRoot,
  loadPersistedRoot,
  persistProjectRoot,
} from "@/lib/agent/project-context";

/**
 * Project-root state for the Code workspace.
 *
 * Reads the persisted root on startup, falling back to the detected
 * local root, and exposes a setter that persists the next root. The
 * hook owns both the state and the storage write, so a caller only
 * ever deals in a root string.
 *
 * The initial value is `null` on the server and during the first
 * client render — the same way `useIsClient` stays false until
 * hydration — so the server build never reads `localStorage`.
 */
export function useProjectContext(): {
  readonly root: string | null;
  readonly resolved: boolean;
  readonly setRoot: (root: string | null) => void;
} {
  const [root, setRootState] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  if (!resolved) {
    // Adjusting state during render is the supported way to
    // initialise from browser-only state: it runs once, on the
    // client, and the server render never reaches it.
    const stored = loadPersistedRoot();
    setRootState(stored !== null ? stored : detectLocalRoot());
    setResolved(true);
  }

  const setRoot = useCallback((next: string | null) => {
    setRootState(next);
    persistProjectRoot(next);
  }, []);

  return { root, resolved, setRoot };
}