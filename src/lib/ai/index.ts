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
  invalidRequest,
  isAiProviderError,
  modelUnavailable,
  noEligibleModel,
  providerRequestFailed,
  providerUnavailable,
  type AiErrorCode,
} from "./errors";
export {
  DEFAULT_ELIGIBILITY_POLICY,
  NO_FREE_MODEL_DETAIL,
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
export {
  ERROR_STATUS,
  parseChatStreamEvent,
  type ChatRequestBody,
  type ChatStreamError,
  type ChatStreamEvent,
  type ChatStreamMeta,
  type ChatTurn,
  type PinnedModelRef,
} from "./chat-protocol";
export {
  MAX_TOTAL_CHARS,
  MAX_TURNS,
  MAX_TURN_CHARS,
  parseChatRequest,
} from "./chat-request";
export {
  selectChatModel,
  streamChatEvents,
  toChatStreamError,
  type ChatStreamOptions,
} from "./chat-service";
export { getAiGateway, resetAiGateway } from "./runtime";
export {
  costScore,
  estimateCost,
  estimateInputTokens,
  isFreeModel,
  type CostEstimate,
} from "./pricing";
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
  type StreamOptions,
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
  DECLARABLE_AVAILABILITIES,
  DEFAULT_PRIORITY,
  describeModel,
  humanizeModelId,
  indexDeclarations,
  lookupDeclaration,
  type DeclarationIndex,
  type DeclarableAvailability,
  type ModelDeclaration,
} from "./providers/model-declaration";
export {
  DECLARATIONS_JSON_VAR,
  DECLARATIONS_PATH_VAR,
  loadDeclarationSetOrEmpty,
  loadDeclarationsFromEnv,
  loadDeclarationsFromFile,
  loadDeclarationsFromJson,
  type DeclarationLoadResult,
  type DeclarationSource,
} from "./declaration-loader";
export {
  DECLARATION_ISSUE_CODES,
  formatDeclarationIssues,
  isDeclarableAvailability,
  validateDeclarationDocument,
  validateModelDeclaration,
  type DeclarationIssue,
  type DeclarationIssueCode,
  type DeclarationResult,
} from "./declaration-schema";
export {
  DeclarationSet,
  EMPTY_DECLARATION_SET,
  createDeclarationSet,
} from "./declarations";
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