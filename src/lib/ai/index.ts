export {
  acceptsModality,
  isAudioOutputOnly,
  isEmbeddingOnly,
  isImageOutputOnly,
  isModality,
  isStreamable,
  normalizeCapabilities,
  normalizeModalities,
  producesModality,
  supportsSystemMessages,
  supportsTextChat,
} from "./capabilities";
export {
  PROVIDER_ENV_SPECS,
  PROVIDER_IDS,
  getProviderEnvSpec,
  normalizeBaseUrl,
  resolveAllProviderConfigs,
  resolveProviderConfig,
  type ConfigurableProviderId,
  type ProviderConfigResult,
  type ProviderEnvSpec,
  type ResolvedProviderConfig,
} from "./config";
export {
  AI_ERROR_CODES,
  AiProviderError,
  isAiProviderError,
  modelUnavailable,
  noEligibleModel,
  providerRequestFailed,
  providerUnavailable,
  type AiErrorCode,
} from "./errors";
export {
  DEFAULT_ELIGIBILITY_POLICY,
  evaluateModelEligibility,
  isPinnedModel,
  partitionByEligibility,
  policyForRequest,
  sameModel,
  type EligibilityDecision,
  type EligibilityPolicy,
  type EligibilityReport,
  type ProviderState,
  type RejectionReason,
} from "./eligibility";
export {
  AiGateway,
  createAiGateway,
  describeExclusions,
  type Catalog,
  type CatalogEntry,
  type GatewayOptions,
  type SelectionResult,
} from "./gateway";
export { costScore, estimateCost, estimateInputTokens, type CostEstimate } from "./pricing";
export type { AiProvider, AiProviderInfo } from "./provider";
export { ProviderRegistry, createProviderRegistry } from "./registry";
export { rankCandidates, scoreForStrategy, selectModel, type RankedCandidate } from "./router";
export { assertServerOnly } from "./server-only";
export {
  MODALITIES,
  UNKNOWN_CONTEXT,
  UNVERIFIED_CAPABILITIES,
  type ChatMessage,
  type ChatRequest,
  type ChatRole,
  type FinishReason,
  type GenerationChunk,
  type GenerationResult,
  type Modality,
  type ModelAvailability,
  type ModelCapabilities,
  type ModelContextInfo,
  type ModelDescriptor,
  type ModelPricing,
  type ModelRef,
  type PricingTier,
  type ProviderHealth,
  type ProviderId,
  type ProviderKind,
  type ProviderStatus,
  type RoutingStrategy,
  type TokenUsage,
} from "./types";
export {
  createFreeLlmApiProvider,
  FREELLMAPI_PROVIDER_ID,
  type FreeLlmApiProviderOptions,
} from "./providers/freellm";
export {
  createOmniRouteProvider,
  OMNIROUTE_PROVIDER_ID,
  type OmniRouteProviderOptions,
} from "./providers/omniroute";
export {
  describeModel,
  humanizeModelId,
  indexDeclarations,
  type DeclarationIndex,
  type ModelDeclaration,
} from "./providers/model-declaration";
export {
  createOpenAiCompatibleProvider,
  parseSseDataLine,
  readSseLines,
  type OpenAiCompatibleProviderOptions,
} from "./providers/openai-provider";
export {
  OpenAiCompatibleClient,
  isRecord,
  readErrorMessage,
  tryParseJson,
  type FetchLike,
  type OpenAiCompatibleOptions,
} from "./providers/openai-compatible";
export { createGatewayProviders, type CreateProvidersOptions } from "./providers/index";