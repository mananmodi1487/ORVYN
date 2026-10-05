import type { AiProvider, AiProviderInfo } from "../provider";
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from "./openai-provider";

/**
 * Pollinations is an OpenAI-compatible gateway, so it reuses the shared adapter
 * rather than duplicating request and SSE handling. Keeping it a thin wrapper
 * means a difference between gateways is a one-line option here, not a forked
 * copy of the request path.
 *
 * `configured` is supplied by the caller from the resolved environment: this
 * module never reads `process.env`, which keeps it usable from tests without a
 * live endpoint and keeps credentials out of module scope.
 *
 * The API key is a Pollinations Secret key (`sk_`), which Pollinations' own docs
 * describe as "Server-side only — Never expose in client-side code, git repos,
 * or public URLs". ORVYN reads it through `resolveProviderConfig`, which is
 * server-only and never `NEXT_PUBLIC_`-prefixed, so it stays out of the bundle.
 */
export interface PollinationsProviderOptions
  extends Omit<OpenAiCompatibleProviderOptions, "info"> {
  readonly configured: boolean;
  readonly configurationDetail?: string | null | undefined;
  readonly displayName?: string | undefined;
}

export const POLLINATIONS_PROVIDER_ID = "pollinations";

export function createPollinationsProvider(
  options: PollinationsProviderOptions,
): AiProvider {
  const info: AiProviderInfo = {
    id: POLLINATIONS_PROVIDER_ID,
    kind: "gateway",
    displayName: options.displayName ?? "Pollinations",
    configured: options.configured,
    configurationDetail: options.configurationDetail ?? null,
  };
  return createOpenAiCompatibleProvider({ ...options, info });
}