/**
 * Core domain types for the ORVYN AI provider abstraction.
 *
 * Nothing in this file imports React, Next.js or a provider SDK. Everything the
 * gateway, router and eligibility layer need is expressed here so providers can
 * be added without touching routing logic.
 */

/** Stable identifier for a provider or gateway, e.g. `omniroute`. */
export type ProviderId = string;

/**
 * How a provider is reached.
 * - `gateway` routes to many upstream vendors behind one endpoint (OmniRoute,
 *   FreeLLMAPI).
 * - `direct` is a first-party vendor endpoint added later.
 */
export type ProviderKind = "gateway" | "direct";

/** Content kinds a model can accept or produce. */
export const MODALITIES = [
  "text",
  "image",
  "audio",
  "tts",
  "stt",
  "embedding",
  "rerank",
] as const;

export type Modality = (typeof MODALITIES)[number];

export type ModelAvailability =
  | "available"
  | "degraded"
  | "unavailable"
  | "retired"
  | "unknown";

export interface ModelCapabilities {
  /** Kinds of input the model accepts. */
  readonly inputModalities: readonly Modality[];
  /** Kinds of output the model produces. */
  readonly outputModalities: readonly Modality[];
  readonly supportsStreaming: boolean;
  readonly supportsSystemPrompt: boolean;
  readonly supportsTools: boolean;
  readonly supportsJsonOutput: boolean;
}

/**
 * Capabilities that assert nothing. Used for models whose real capabilities have
 * not been declared by configuration, so they cannot be mistaken for
 * text-chat capable.
 */
export const UNVERIFIED_CAPABILITIES: ModelCapabilities = {
  inputModalities: [],
  outputModalities: [],
  supportsStreaming: false,
  supportsSystemPrompt: false,
  supportsTools: false,
  supportsJsonOutput: false,
};

export type PricingTier = "free" | "paid" | "unknown";

export interface ModelPricing {
  readonly currency: "USD";
  readonly tier: PricingTier;
  /** USD per 1M input tokens. `null` when the provider did not report it. */
  readonly inputPerMillionTokens: number | null;
  /** USD per 1M output tokens. `null` when the provider did not report it. */
  readonly outputPerMillionTokens: number | null;
}

/**
 * Context limits. `null` means unknown rather than unlimited, so cost and
 * quality scoring never treats a missing figure as unlimited headroom.
 */
export interface ModelContextInfo {
  readonly contextWindowTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly source: "declared" | "observed" | "unknown";
}

export const UNKNOWN_CONTEXT: ModelContextInfo = {
  contextWindowTokens: null,
  maxOutputTokens: null,
  source: "unknown",
};

export interface ModelDescriptor {
  readonly provider: ProviderId;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  readonly availability: ModelAvailability;
  /** Operator switch. Disabled models are never routed to. */
  readonly enabled: boolean;
  readonly pricing: ModelPricing;
  readonly context: ModelContextInfo;
  /**
   * Operator preference, higher wins among candidates a routing strategy scores
   * equally. Defaults to 0. Advisory only — it never overrides eligibility.
   */
  readonly priority: number;
  readonly tags: readonly string[];
}

/** Points at exactly one model on exactly one provider. */
export interface ModelRef {
  readonly provider: ProviderId;
  readonly modelId: string;
}

export type ProviderStatus = "up" | "degraded" | "down";

export interface ProviderHealth {
  readonly provider: ProviderId;
  readonly status: ProviderStatus;
  /** The single gate for provider-level eligibility. */
  readonly reachable: boolean;
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly detail: string | null;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

/** Explicitly selects how the router should choose among eligible models. */
export type RoutingStrategy = "balanced" | "lowest-latency" | "lowest-cost" | "highest-quality";

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  /** When set, the router must use this exact model or fail. */
  readonly pinnedModel?: ModelRef | undefined;
  readonly strategy?: RoutingStrategy | undefined;
  readonly requireStreaming?: boolean | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly temperature?: number | undefined;
}

export interface TokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export type FinishReason = "stop" | "length" | "content_filter" | "tool_calls" | "error";

export interface GenerationResult {
  readonly model: ModelDescriptor;
  readonly content: string;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage | null;
  readonly providerRequestId: string | null;
}

export type GenerationChunk =
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "done"; readonly finishReason: FinishReason };

/**
 * Per-call controls for `stream`.
 *
 * `signal` lets a caller (an HTTP client disconnecting, a Stop button) cancel
 * in-flight work. Aborting ends the iteration normally rather than surfacing as
 * an error, because the reason for stopping is the caller's own decision.
 */
export interface StreamOptions {
  readonly signal?: AbortSignal | undefined;
}