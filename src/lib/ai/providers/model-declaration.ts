import { normalizeCapabilities } from "../capabilities";
import type {
  ModelAvailability,
  ModelContextInfo,
  ModelDescriptor,
  ModelPricing,
  ProviderId,
} from "../types";
import { UNKNOWN_CONTEXT } from "../types";

/**
 * Availability a declaration may state explicitly. `unknown` is deliberately
 * absent: an operator can withhold a verdict, but cannot assert ignorance as
 * fact — a declaration that exists is a statement that something was confirmed.
 */
export const DECLARABLE_AVAILABILITIES = [
  "available",
  "degraded",
  "unavailable",
  "retired",
] as const;

export type DeclarableAvailability = (typeof DECLARABLE_AVAILABILITIES)[number];

/**
 * Facts about a model that a provider's `/models` response does not contain.
 *
 * An OpenAI-compatible list gives an id, an owner, and a creation timestamp. It
 * says nothing about modalities, streaming support, price, or context window.
 * Rather than guess those, an adapter reports them as unknown and lets this
 * declaration supply them.
 *
 * Declarations are operator-supplied configuration, never something inferred
 * from the id string. A model with no declaration stays unroutable.
 */
export interface ModelDeclaration {
  readonly provider: ProviderId;
  readonly modelId: string;
  readonly displayName?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly capabilities?: unknown;
  readonly availability?: DeclarableAvailability | undefined;
  readonly pricing?: Partial<ModelPricing> | undefined;
  readonly context?: Partial<ModelContextInfo> | undefined;
  /** Operator switch. Defaults to false: a model is routed to only on purpose. */
  readonly enabled?: boolean | undefined;
  /**
   * Operator-declared free-allowance flag.
   *
   * True when the operator confirms the model is served under a zero-cost
   * allowance the operator funds — a daily compute budget that stops rather
   * than bills — rather than the model being permanently zero-priced.
   *
   * This is deliberately separate from `pricing.tier`. A free-allowance model
   * still publishes metered rates and is still `tier: "paid"` or `"unknown"`;
   * the flag is what lets it through a free-only policy. Without it, the model
   * is rejected like any other paid or unpriced one.
   *
   * Defaults to false. It is never inferred from a model id or provider name.
   */
  readonly freeAllowance?: boolean | undefined;
  /**
   * Operator preference, higher wins among candidates a strategy scores
   * equally. Defaults to 0. Never a substitute for eligibility.
   */
  readonly priority?: number | undefined;
}

/**
 * Declarations are provider-qualified: the same model id can exist on two
 * providers with different capabilities, prices, and priorities.
 *
 * The index is nested by provider rather than keyed by a joined string, so no
 * separator character can ever collide with a provider or model id.
 */
export type DeclarationIndex = ReadonlyMap<ProviderId, ReadonlyMap<string, ModelDeclaration>>;

export function lookupDeclaration(
  index: DeclarationIndex,
  provider: ProviderId,
  modelId: string,
): ModelDeclaration | undefined {
  return index.get(provider)?.get(modelId);
}

/**
 * Builds the lookup index.
 *
 * Duplicates are rejected rather than last-write-wins: two conflicting
 * declarations for one provider/model pair is a configuration mistake, and
 * silently preferring one of them would hide it.
 */
export function indexDeclarations(
  declarations: readonly ModelDeclaration[] = [],
): DeclarationIndex {
  const index = new Map<ProviderId, Map<string, ModelDeclaration>>();
  for (const declaration of declarations) {
    const forProvider = index.get(declaration.provider) ?? new Map<string, ModelDeclaration>();
    if (forProvider.has(declaration.modelId)) {
      throw new Error(
        `Duplicate model declaration for "${declaration.provider}/${declaration.modelId}"`,
      );
    }
    forProvider.set(declaration.modelId, declaration);
    index.set(declaration.provider, forProvider);
  }
  return index;
}

const UNPRICED: ModelPricing = {
  currency: "USD",
  tier: "unknown",
  inputPerMillionTokens: null,
  outputPerMillionTokens: null,
};

export const DEFAULT_PRIORITY = 0;

function buildPricing(declaration: ModelDeclaration | undefined): ModelPricing {
  const declared = declaration?.pricing;
  if (declared === undefined) return UNPRICED;
  return {
    currency: "USD",
    tier: declared.tier ?? "unknown",
    inputPerMillionTokens: declared.inputPerMillionTokens ?? null,
    outputPerMillionTokens: declared.outputPerMillionTokens ?? null,
  };
}

function buildContext(declaration: ModelDeclaration | undefined): ModelContextInfo {
  const declared = declaration?.context;
  if (declared === undefined) return UNKNOWN_CONTEXT;
  const declaredSomething =
    declared.contextWindowTokens !== undefined || declared.maxOutputTokens !== undefined;
  return {
    contextWindowTokens: declared.contextWindowTokens ?? null,
    maxOutputTokens: declared.maxOutputTokens ?? null,
    source: declared.source ?? (declaredSomething ? "declared" : "unknown"),
  };
}

function buildAvailability(declaration: ModelDeclaration | undefined): ModelAvailability {
  // No declaration means we never confirmed this model against the provider.
  // That stays `unknown`, which is ineligible — fail closed.
  if (declaration === undefined) return "unknown";
  return declaration.availability ?? "available";
}

/**
 * `gpt-4o-mini` reads better as `gpt 4o mini`. Presentation only — it carries
 * no capability meaning and is never parsed back.
 */
export function humanizeModelId(modelId: string): string {
  return modelId
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => (word === word.toUpperCase() ? word : word.toLowerCase()))
    .join(" ");
}

/**
 * Maps one provider-reported model id onto a descriptor, merging the
 * declaration for that exact provider and model id.
 *
 * Every field the declaration omits keeps its unknown default, so a partial
 * declaration never fabricates metadata it does not state.
 */
export function describeModel(
  providerId: ProviderId,
  modelId: string,
  declarations: DeclarationIndex,
): ModelDescriptor {
  const declaration = lookupDeclaration(declarations, providerId, modelId);
  return {
    provider: providerId,
    modelId,
    displayName: declaration?.displayName ?? humanizeModelId(modelId),
    capabilities: normalizeCapabilities(declaration?.capabilities),
    availability: buildAvailability(declaration),
    enabled: declaration?.enabled ?? false,
    pricing: buildPricing(declaration),
    context: buildContext(declaration),
    priority: declaration?.priority ?? DEFAULT_PRIORITY,
    tags: declaration?.tags ?? [],
    freeAllowance: declaration?.freeAllowance ?? false,
  };
}