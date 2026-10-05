import type { AiProvider, AiProviderInfo } from "@/lib/ai/provider";
import type {
  ChatRequest,
  GenerationChunk,
  GenerationResult,
  ModelCapabilities,
  ModelDescriptor,
  ModelRef,
  ProviderHealth,
  ProviderId,
  TokenUsage,
} from "@/lib/ai/types";

/**
 * Deterministic in-memory provider for tests.
 *
 * Models, health and responses are supplied by the test, never invented here.
 * Every call is recorded so a test can assert that an ineligible provider was
 * not contacted at all.
 */
export interface FakeProviderOptions {
  readonly id: ProviderId;
  readonly models?: readonly ModelDescriptor[] | undefined;
  readonly configured?: boolean | undefined;
  readonly configurationDetail?: string | null | undefined;
  readonly health?: ProviderHealth | undefined;
  readonly listError?: Error | undefined;
  readonly generateError?: Error | undefined;
  readonly streamError?: Error | undefined;
  readonly content?: string | undefined;
  readonly chunks?: readonly string[] | undefined;
}

export interface FakeProvider extends AiProvider {
  readonly calls: {
    listModels: number;
    healthCheck: number;
    generate: readonly ModelRef[];
    stream: readonly ModelRef[];
  };
}

export function makeModel(
  overrides: Partial<ModelDescriptor> & { provider: ProviderId; modelId: string },
): ModelDescriptor {
  return {
    provider: overrides.provider,
    modelId: overrides.modelId,
    displayName: overrides.displayName ?? overrides.modelId,
    capabilities: overrides.capabilities ?? textChatCapabilities(),
    availability: overrides.availability ?? "available",
    enabled: overrides.enabled ?? true,
    pricing: overrides.pricing ?? {
      currency: "USD",
      tier: "paid",
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 2,
    },
    context: overrides.context ?? {
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_096,
      source: "declared",
    },
    tags: overrides.tags ?? [],
  };
}

export function textChatCapabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsStreaming: true,
    supportsSystemPrompt: true,
    supportsTools: false,
    supportsJsonOutput: false,
    ...overrides,
  };
}

export function healthy(provider: ProviderId, latencyMs: number | null = 120): ProviderHealth {
  return {
    provider,
    status: "up",
    reachable: true,
    checkedAt: "2026-01-01T00:00:00.000Z",
    latencyMs,
    detail: null,
  };
}

export function unreachable(provider: ProviderId, detail = "connection refused"): ProviderHealth {
  return {
    provider,
    status: "down",
    reachable: false,
    checkedAt: "2026-01-01T00:00:00.000Z",
    latencyMs: null,
    detail,
  };
}

export function createFakeProvider(options: FakeProviderOptions): FakeProvider {
  const info: AiProviderInfo = {
    id: options.id,
    kind: "gateway",
    displayName: options.id,
    configured: options.configured ?? true,
    configurationDetail: options.configurationDetail ?? null,
  };
  const calls = { listModels: 0, healthCheck: 0, generate: [] as ModelRef[], stream: [] as ModelRef[] };

  const provider: FakeProvider = {
    info,
    calls,
    async listModels(): Promise<readonly ModelDescriptor[]> {
      calls.listModels += 1;
      if (!info.configured) return [];
      if (options.listError !== undefined) throw options.listError;
      return options.models ?? [];
    },
    async healthCheck(): Promise<ProviderHealth> {
      calls.healthCheck += 1;
      // Mirrors the real contract: an unconfigured provider reports down
      // without touching the network.
      if (!info.configured) {
        return {
          provider: options.id,
          status: "down",
          reachable: false,
          checkedAt: "2026-01-01T00:00:00.000Z",
          latencyMs: null,
          detail: info.configurationDetail,
        };
      }
      return options.health ?? healthy(options.id);
    },
    async generate(_request: ChatRequest, model: ModelRef): Promise<GenerationResult> {
      calls.generate.push(model);
      if (options.generateError !== undefined) throw options.generateError;
      const descriptor = findModel(options.models ?? [], options.id, model.modelId);
      return {
        model: descriptor,
        content: options.content ?? "ok",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 } satisfies TokenUsage,
        providerRequestId: `req-${calls.generate.length}`,
      };
    },
    async *stream(_request: ChatRequest, model: ModelRef): AsyncIterable<GenerationChunk> {
      calls.stream.push(model);
      if (options.streamError !== undefined) throw options.streamError;
      for (const delta of options.chunks ?? ["ok"]) {
        yield { type: "text", delta };
      }
      yield { type: "done", finishReason: "stop" };
    },
  };
  return provider;
}

function findModel(
  models: readonly ModelDescriptor[],
  provider: ProviderId,
  modelId: string,
): ModelDescriptor {
  return (
    models.find((model) => model.provider === provider && model.modelId === modelId) ?? {
      provider,
      modelId,
      displayName: modelId,
      capabilities: textChatCapabilities(),
      availability: "unknown",
      enabled: false,
      pricing: { currency: "USD", tier: "unknown", inputPerMillionTokens: null, outputPerMillionTokens: null },
      context: { contextWindowTokens: null, maxOutputTokens: null, source: "unknown" },
      tags: [],
    }
  );
}