import type {
  ChatRequest,
  GenerationChunk,
  GenerationResult,
  ModelDescriptor,
  ModelRef,
  ProviderHealth,
  ProviderId,
  ProviderKind,
} from "./types";

/**
 * Identity and configuration a provider exposes to the gateway.
 *
 * `configured` is a hard gate. An unconfigured provider is never asked for
 * health or models, so a missing base URL or key can never turn into a network
 * call.
 */
export interface AiProviderInfo {
  readonly id: ProviderId;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly configured: boolean;
  /** Human-readable reason `configured` is false. Never contains secrets. */
  readonly configurationDetail: string | null;
}

/**
 * The contract every provider implementation satisfies.
 *
 * Implementations must translate their own failures into `AiProviderError` and
 * must not throw anything else across this boundary.
 */
export interface AiProvider {
  readonly info: AiProviderInfo;

  /** Models this provider currently exposes. */
  listModels(): Promise<readonly ModelDescriptor[]>;

  /** Probes the provider without sending a generation request. */
  healthCheck(): Promise<ProviderHealth>;

  /** Non-streaming completion. Rejects with `AiProviderError` on failure. */
  generate(request: ChatRequest, model: ModelRef): Promise<GenerationResult>;

  /** Streamed completion. Rejects with `AiProviderError` before the first chunk on failure. */
  stream(request: ChatRequest, model: ModelRef): AsyncIterable<GenerationChunk>;
}