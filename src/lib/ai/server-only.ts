/**
 * Server boundary for the AI layer.
 *
 * `server-only` is not installed, so this is a runtime guard instead of a
 * build-time one. It is intentionally dependency-free and throws the moment any
 * AI module is pulled into a client bundle. Credentials are read in `config.ts`
 * from non-public environment variables, so importing it from the browser would
 * leak them even if the guard were bypassed.
 */
export function assertServerOnly(what: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${what} is server-only. AI provider credentials and routing must never run in the browser.`,
    );
  }
}