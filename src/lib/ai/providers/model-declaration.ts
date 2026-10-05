import { normalizeCapabilities } from "../capabilities";
import type {
  ModelAvailability,
  ModelContextInfo,
  ModelDescriptor,
  ModelPricing,
} from "../types";
import { UNKNOWN_CONTEXT } from "../types";

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
  readonly modelId: string;
  readonly displayName?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly capabilities?: unknown;
  readonly pricing?: Partial<ModelPricing> | undefined;
  readonly context?: Partial<ModelContextInfo> | undefined;
  /** Operator switch. Defaults to false: a model is routed to only on purpose. */
  readonly enabled?: boolean | undefined;
}

export type DeclarationIndex = ReadonlyMap<string, ModelDeclaration>;

export function indexDeclarations(
  declarations: readonly ModelDeclaration[] = [],
): DeclarationIndex {
  const index = new Map<string, ModelDeclaration>();
  for (const declaration of declarations) index.set(declaration.modelId, declaration);
  return index;
}

const UNPRICED: ModelPricing = {
  currency: "USD",
  tier: "unknown",
  inputPerMillionTokens: null,
  outputPerMillionTokens: null,
};

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
  return declaration === undefined ? "unknown" : "available";
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
 * declaration for that exact id.
 */
export function describeModel(
  providerId: string,
  modelId: string,
  declarations: DeclarationIndex,
): ModelDescriptor {
  const declaration = declarations.get(modelId);
  return {
    provider: providerId,
    modelId,
    displayName: declaration?.displayName ?? humanizeModelId(modelId),
    capabilities: normalizeCapabilities(declaration?.capabilities),
    availability: buildAvailability(declaration),
    enabled: declaration?.enabled ?? false,
    pricing: buildPricing(declaration),
    context: buildContext(declaration),
    tags: declaration?.tags ?? [],
  };
}