import type { AiProvider, AiProviderInfo } from "../provider";
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from "./openai-provider";

/**
 * OmniRoute is an OpenAI-compatible gateway, so it reuses the shared adapter
 * rather than duplicating request and SSE handling.
 *
 * `configured` is supplied by the caller from the resolved environment: this
 * module never reads `process.env`, which keeps it usable from tests without a
 * live endpoint and keeps credentials out of module scope.
 */
export interface OmniRouteProviderOptions
  extends Omit<OpenAiCompatibleProviderOptions, "info"> {
  readonly configured: boolean;
  readonly configurationDetail?: string | null | undefined;
  readonly displayName?: string | undefined;
}

export const OMNIROUTE_PROVIDER_ID = "omniroute";

export function createOmniRouteProvider(options: OmniRouteProviderOptions): AiProvider {
  const info: AiProviderInfo = {
    id: OMNIROUTE_PROVIDER_ID,
    kind: "gateway",
    displayName: options.displayName ?? "OmniRoute",
    configured: options.configured,
    configurationDetail: options.configurationDetail ?? null,
  };
  return createOpenAiCompatibleProvider({ ...options, info });
}