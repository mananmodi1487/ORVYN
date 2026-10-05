import type { AiProvider, AiProviderInfo } from "../provider";
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from "./openai-provider";

/**
 * FreeLLMAPI is also an OpenAI-compatible gateway, so it reuses the shared
 * adapter. Keeping it a thin wrapper means a difference between the two
 * gateways is a one-line option here, not a forked copy of the request path.
 */
export interface FreeLlmApiProviderOptions
  extends Omit<OpenAiCompatibleProviderOptions, "info"> {
  readonly configured: boolean;
  readonly configurationDetail?: string | null | undefined;
  readonly displayName?: string | undefined;
}

export const FREELLMAPI_PROVIDER_ID = "freellmapi";

export function createFreeLlmApiProvider(options: FreeLlmApiProviderOptions): AiProvider {
  const info: AiProviderInfo = {
    id: FREELLMAPI_PROVIDER_ID,
    kind: "gateway",
    displayName: options.displayName ?? "FreeLLMAPI",
    configured: options.configured,
    configurationDetail: options.configurationDetail ?? null,
  };
  return createOpenAiCompatibleProvider({ ...options, info });
}