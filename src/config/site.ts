/**
 * Single source of truth for brand-level strings shared across the app.
 * Keep secrets and environment-specific values out of this file.
 */
export const siteConfig = {
  name: "ORVYN",
  description: "A production-ready Next.js foundation.",
  locale: "en-US",
} as const;

export type SiteConfig = typeof siteConfig;
