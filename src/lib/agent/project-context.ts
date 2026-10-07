/**
 * Project-root context for the ORVYN Code workspace.
 *
 * A coding mission runs against a local repository, so the browser needs to
 * tell the local agent which one. This module is the single place that
 * knows how a project root is detected, normalised, and persisted — the
 * bridge only carries the string, and the agent only receives it.
 *
 * Nothing here is React or Next.js: the pure helpers below can be imported
 * from a hook or a server route without pulling in the framework.
 * Browser-only APIs (`localStorage`) are guarded so the module is safe to
 * import during server rendering.
 */

/** The key the persisted project root is stored under. */
export const PROJECT_ROOT_STORAGE_KEY = "orvyn.code.projectRoot" as const;

export type ProjectContext = {
  /** The absolute or relative path the user chose. Null until one is set. */
  readonly root: string | null;
  /** True once the persisted/detected root has been read from storage. */
  readonly resolved: boolean;
};

/**
 * Normalises a project-root string: trims, collapses redundant
 * separators, and strips a trailing separator so the path is
 * stable to compare and to send.
 */
export function normalizeProjectPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  // Replace backslashes (Windows) with forward slashes so a path
  // typed on either platform compares equal.
  const normalised = trimmed.replace(/\\/g, "/");
  return normalised.replace(/\/+$/g, "");
}

/**
 * Detects the local ORVYN repository root from the current page origin.
 *
 * The web app cannot read the filesystem, so this is a hint, not a
 * guarantee: it returns the workspace the app itself is served from —
 * the ORVYN repository — which is the default project a Code mission
 * would run against. The user can always change it.
 *
 * Returns `null` when no usable origin is available (SSR, a non-browser
 * environment, or an opaque origin), so callers can fall back to asking.
 */
export function detectLocalRoot(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location?.origin;
  if (!origin || origin === "null") return null;
  return normalizeProjectPath(origin);
}

/**
 * Whether a path looks like a usable project root. A non-empty,
 * non-opaque path is enough — the agent validates reachability itself.
 */
export function isValidProjectRoot(path: string): boolean {
  return path.length > 0 && path !== "null";
}

/**
 * Reads the persisted project root from `localStorage`. Returns `null`
 * when nothing is stored or the storage is unavailable — never throws.
 */
export function loadPersistedRoot(): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(PROJECT_ROOT_STORAGE_KEY);
    if (raw === null) return null;
    const normalised = normalizeProjectPath(raw);
    return isValidProjectRoot(normalised) ? normalised : null;
  } catch {
    // A private-mode or quota failure is not a project error.
    return null;
  }
}

/**
 * Persists a project root so it survives a refresh. A `null` value
 * clears the stored root, which is how "use the detected root"
 * is expressed: nothing is stored, and detection runs again.
 */
export function persistProjectRoot(root: string | null): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (root === null) {
      window.localStorage.removeItem(PROJECT_ROOT_STORAGE_KEY);
      return;
    }
    const normalised = normalizeProjectPath(root);
    if (!isValidProjectRoot(normalised)) return;
    window.localStorage.setItem(PROJECT_ROOT_STORAGE_KEY, normalised);
  } catch {
    // Storage failure is non-blocking: the mission still runs,
    // it just won't remember the root next time.
  }
}

/**
 * The basename of a path, for display. Falls back to the full path
 * when it has no separator, and to a placeholder when there is none.
 */
export function projectLabel(path: string | null): string {
  if (path === null || path === "") return "No project";
  const normalised = path.replace(/\\/g, "/");
  const last = normalised.split("/").pop();
  return last !== undefined && last !== "" ? last : path;
}