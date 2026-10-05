import type { AiProvider, AiProviderInfo } from "../provider";
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions,
} from "./openai-provider";

/**
 * Groq is an OpenAI-compatible gateway, so it reuses the shared adapter rather
 * than duplicating request and SSE handling. Keeping it a thin wrapper means a
 * difference between gateways is a one-line option here, not a forked copy of
 * the request path.
 *
 * `configured` is supplied by the caller from the resolved environment: this
 * module never reads `process.env`, which keeps it usable from tests without a
 * live endpoint and keeps credentials out of module scope.
 */
export interface GroqProviderOptions
  extends Omit<OpenAiCompatibleProviderOptions, "info"> {
  readonly configured: boolean;
  readonly configurationDetail?: string | null | undefined;
  readonly displayName?: string | undefined;
}

export const GROQ_PROVIDER_ID = "groq";

export function createGroqProvider(options: GroqProviderOptions): AiProvider {
  const info: AiProviderInfo = {
    id: GROQ_PROVIDER_ID,
    kind: "gateway",
    displayName: options.displayName ?? "Groq",
    configured: options.configured,
    configurationDetail: options.configurationDetail ?? null,
  };
  return createOpenAiCompatibleProvider({ ...options, info });
}