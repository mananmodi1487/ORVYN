import type { AiProvider, AiProviderInfo } from "../provider";
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from "./openai-provider";

/**
 * Cloudflare Workers AI is an OpenAI-compatible inference endpoint, so it reuses
 * the shared adapter rather than duplicating request and SSE handling. Keeping
 * it a thin wrapper means a difference between providers is a one-line option
 * here, not a forked copy of the request path.
 *
 * `configured` is supplied by the caller from the resolved environment: this
 * module never reads `process.env`, which keeps it usable from tests without a
 * live endpoint and keeps credentials out of module scope.
 *
 * The API token is a Cloudflare API token scoped to the account. It is
 * server-side only: it authenticates inference calls that would otherwise be
 * unauthenticated, and a token that reached the browser would let any visitor
 * spend ORVYN's daily Neuron allowance. ORVYN reads it through
 * `resolveProviderConfig`, which is server-only and never `NEXT_PUBLIC_`-prefixed.
 */
export interface CloudflareProviderOptions
  extends Omit<OpenAiCompatibleProviderOptions, "info" | "baseUrl"> {
  readonly configured: boolean;
  readonly configurationDetail?: string | null | undefined;
  readonly displayName?: string | undefined;
  /**
   * Cloudflare embeds the account id in the URL path
   * (`/accounts/{accountId}/ai/v1`), so the base URL is not static. The factory
   * interpolates it here rather than trusting the caller to supply a joined
   * string, which keeps the account id out of any other module's hands.
   *
   * Optional: an unconfigured provider is still constructed (so the catalog can
   * report *why*) and never touches the network, so the account id may be
   * absent.
   */
  readonly accountId?: string | undefined;
  /** The static prefix, e.g. `https://api.cloudflare.com/client/v4`. */
  readonly accountPrefix: string;
}

export const CLOUDFLARE_PROVIDER_ID = "cloudflare";

/**
 * Static URL prefix for Cloudflare's REST API. The account id is interpolated
 * per-deployment by the provider factory; this prefix is the same for every
 * Cloudflare account and is safe to keep in source.
 */
export const CLOUDFLARE_ACCOUNT_PREFIX = "https://api.cloudflare.com/client/v4";

/**
 * Builds the Workers AI base URL from its static prefix and account id.
 *
 * The account id is interpolated here and only here, so a missing or malformed
 * value cannot produce a request that silently hits a wrong endpoint. The
 * caller is responsible for having validated the id as a non-empty string.
 */
export function cloudflareBaseUrl(accountPrefix: string, accountId: string): string {
  const prefix = accountPrefix.replace(/\/+$/, "");
  const id = accountId.replace(/^\/+|\/+$/g, "");
  return `${prefix}/accounts/${id}/ai/v1`;
}

export function createCloudflareProvider(
  options: CloudflareProviderOptions,
): AiProvider {
  const info: AiProviderInfo = {
    id: CLOUDFLARE_PROVIDER_ID,
    kind: "gateway",
    displayName: options.displayName ?? "Cloudflare",
    configured: options.configured,
    configurationDetail: options.configurationDetail ?? null,
  };
  // An unconfigured provider is constructed but never contacted, so the URL is
  // allowed to be empty here. A configured one without an account id would be a
  // misconfiguration the resolver should already have rejected.
  const baseUrl =
    options.configured && options.accountId !== undefined && options.accountId !== ""
      ? cloudflareBaseUrl(options.accountPrefix, options.accountId)
      : "";
  return createOpenAiCompatibleProvider({
    ...options,
    info,
    baseUrl,
  });
}