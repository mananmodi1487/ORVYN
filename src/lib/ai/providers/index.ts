import { resolveAllProviderConfigs } from "../config";
import { createFreeLlmApiProvider, FREELLMAPI_PROVIDER_ID } from "./freellm";
import { createOmniRouteProvider, OMNIROUTE_PROVIDER_ID } from "./omniroute";
import type { ModelDeclaration } from "./model-declaration";
import type { FetchLike } from "./openai-compatible";
import type { AiProvider } from "../provider";

/**
 * Composition root for the OpenAI-compatible gateways.
 *
 * Reads credentials from the environment, never from source. A provider whose
 * pair of variables is missing is still created — marked `configured: false` —
 * so the catalog can report *why* it is unavailable instead of pretending the
 * provider does not exist.
 *
 * No model declarations are shipped. Capabilities, pricing, and context limits
 * have to be declared by an operator per environment; until then every model
 * reports unknown capabilities and nothing is eligible for routing. That is the
 * intended default: a model is opted into deliberately, not inferred from its id.
 */
export interface CreateProvidersOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly fetchImpl?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  /** Per-provider model facts, keyed by provider id. */
  readonly declarations?: Readonly<Record<string, readonly ModelDeclaration[]>> | undefined;
}

export function createGatewayProviders(options: CreateProvidersOptions = {}): readonly AiProvider[] {
  const resolved = resolveAllProviderConfigs(options.env ?? process.env);
  const shared = {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };

  const providers: AiProvider[] = [];

  const omni = resolved.get(OMNIROUTE_PROVIDER_ID);
  if (omni === undefined) throw new Error("OmniRoute env spec is missing");
  providers.push(
    createOmniRouteProvider({
      configured: omni.ok,
      configurationDetail: omni.ok ? null : omni.reason,
      baseUrl: omni.ok ? omni.config.baseUrl : "",
      apiKey: omni.ok ? omni.config.apiKey : "",
      ...shared,
      declarations: options.declarations?.[OMNIROUTE_PROVIDER_ID] ?? [],
    }),
  );

  const free = resolved.get(FREELLMAPI_PROVIDER_ID);
  if (free === undefined) throw new Error("FreeLLMAPI env spec is missing");
  providers.push(
    createFreeLlmApiProvider({
      configured: free.ok,
      configurationDetail: free.ok ? null : free.reason,
      baseUrl: free.ok ? free.config.baseUrl : "",
      apiKey: free.ok ? free.config.apiKey : "",
      ...shared,
      declarations: options.declarations?.[FREELLMAPI_PROVIDER_ID] ?? [],
    }),
  );

  return providers;
}