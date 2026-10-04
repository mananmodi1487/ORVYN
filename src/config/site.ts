/**
 * Single source of truth for brand-level strings shared across the app.
 * Keep secrets and environment-specific values out of this file.
 */
export const siteConfig = {
  name: "ORVYN",
  description: "One intelligence. Every capability.",
  locale: "en-US",
} as const;

export type SiteConfig = typeof siteConfig;