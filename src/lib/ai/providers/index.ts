import { resolveAllProviderConfigs } from "../config";
import { createFreeLlmApiProvider, FREELLMAPI_PROVIDER_ID } from "./freellm";
import { createGroqProvider, GROQ_PROVIDER_ID } from "./groq";
import { createOmniRouteProvider, OMNIROUTE_PROVIDER_ID } from "./omniroute";
import { createPollinationsProvider, POLLINATIONS_PROVIDER_ID } from "./pollinations";
import { EMPTY_DECLARATION_SET, type DeclarationSet } from "../declarations";
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
 * Model declarations are supplied by the caller as a validated `DeclarationSet`.
 * Nothing is shipped: capabilities, pricing, context limits, and priority have
 * to be declared by an operator per environment, so until they are, every model
 * reports unknown capabilities and nothing is eligible for routing. That is the
 * intended default — a model is opted into deliberately, never inferred from its
 * id, and never filled in with a plausible guess.
 */
export interface CreateProvidersOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly fetchImpl?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  /** Validated declarations. Lookups are provider-qualified. */
  readonly declarations?: DeclarationSet | undefined;
}

export function createGatewayProviders(options: CreateProvidersOptions = {}): readonly AiProvider[] {
  const resolved = resolveAllProviderConfigs(options.env ?? process.env);
  const declarations = options.declarations ?? EMPTY_DECLARATION_SET;
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
      declarations: declarations.forProvider(OMNIROUTE_PROVIDER_ID),
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
      declarations: declarations.forProvider(FREELLMAPI_PROVIDER_ID),
    }),
  );

  const groq = resolved.get(GROQ_PROVIDER_ID);
  if (groq === undefined) throw new Error("Groq env spec is missing");
  providers.push(
    createGroqProvider({
      configured: groq.ok,
      configurationDetail: groq.ok ? null : groq.reason,
      baseUrl: groq.ok ? groq.config.baseUrl : "",
      apiKey: groq.ok ? groq.config.apiKey : "",
      ...shared,
      declarations: declarations.forProvider(GROQ_PROVIDER_ID),
    }),
  );

  const pollinations = resolved.get(POLLINATIONS_PROVIDER_ID);
  if (pollinations === undefined) throw new Error("Pollinations env spec is missing");
  providers.push(
    createPollinationsProvider({
      configured: pollinations.ok,
      configurationDetail: pollinations.ok ? null : pollinations.reason,
      baseUrl: pollinations.ok ? pollinations.config.baseUrl : "",
      apiKey: pollinations.ok ? pollinations.config.apiKey : "",
      ...shared,
      declarations: declarations.forProvider(POLLINATIONS_PROVIDER_ID),
    }),
  );

  return providers;
}