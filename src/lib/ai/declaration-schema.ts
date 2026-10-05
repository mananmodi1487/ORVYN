import {
  DECLARABLE_AVAILABILITIES,
  type DeclarableAvailability,
  type ModelDeclaration,
} from "./providers/model-declaration";
import { isModality } from "./capabilities";
import type { Modality, ModelContextInfo, ModelPricing } from "./types";

/**
 * Runtime validation for operator-supplied model declarations.
 *
 * Declarations arrive as JSON from a file or an environment variable, so they
 * are `unknown` until proven otherwise. This module is the single gate between
 * that untrusted text and the typed `ModelDeclaration` the router trusts.
 *
 * Two rules drive the strictness:
 *
 * 1. **Fail closed.** Anything not stated stays unknown. A missing field is
 *    never filled with a plausible default, because a plausible default is an
 *    invented capability or price.
 * 2. **Reject ambiguity.** Unknown keys, wrong types, contradictory field
 *    combinations, and unrecognised enum members are errors rather than being
 *    dropped. Silently ignoring `"inputModalites"` (a typo) would leave the
 *    model looking text-capable when the operator said otherwise.
 */

/** Stable, machine-readable issue codes. Callers branch on these, not messages. */
export const DECLARATION_ISSUE_CODES = [
  "not_an_object",
  "missing_field",
  "invalid_type",
  "empty_string",
  "unknown_key",
  "unknown_enum_value",
  "not_finite_number",
  "negative_number",
  "unknown_modality",
  "empty_capabilities",
  "contradictory_availability",
  "contradictory_context",
  "contradictory_pricing",
  "duplicate_declaration",
] as const;

export type DeclarationIssueCode = (typeof DECLARATION_ISSUE_CODES)[number];

export interface DeclarationIssue {
  readonly code: DeclarationIssueCode;
  /** JSON-pointer-ish path to the offending value, e.g. `models[2].pricing`. */
  readonly path: string;
  readonly message: string;
}

export type DeclarationResult =
  | { readonly ok: true; readonly declarations: readonly ModelDeclaration[] }
  | { readonly ok: false; readonly issues: readonly DeclarationIssue[] };

const CAPABILITY_KEYS = [
  "inputModalities",
  "outputModalities",
  "supportsStreaming",
  "supportsSystemPrompt",
  "supportsTools",
  "supportsJsonOutput",
] as const;

const PRICING_KEYS = ["tier", "inputPerMillionTokens", "outputPerMillionTokens"] as const;
const CONTEXT_KEYS = ["contextWindowTokens", "maxOutputTokens", "source"] as const;
const DECLARATION_KEYS = [
  "provider",
  "modelId",
  "displayName",
  "tags",
  "capabilities",
  "availability",
  "enabled",
  "priority",
  "pricing",
  "context",
  "freeAllowance",
] as const;

const PRICING_TIERS = ["free", "paid", "unknown"] as const;
const CONTEXT_SOURCES = ["declared", "observed", "unknown"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class IssueCollector {
  readonly issues: DeclarationIssue[] = [];

  add(code: DeclarationIssueCode, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  get ok(): boolean {
    return this.issues.length === 0;
  }
}

function requireNonEmptyString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: IssueCollector,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) {
    issues.add("missing_field", `${path}.${key}`, `"${key}" is required`);
    return undefined;
  }
  if (typeof value !== "string") {
    issues.add("invalid_type", `${path}.${key}`, `"${key}" must be a string`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    issues.add("empty_string", `${path}.${key}`, `"${key}" must not be empty`);
    return undefined;
  }
  return trimmed;
}

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: IssueCollector,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    issues.add("invalid_type", `${path}.${key}`, `"${key}" must be a string`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    issues.add("empty_string", `${path}.${key}`, `"${key}" must not be empty`);
    return undefined;
  }
  return trimmed;
}

function readOptionalBoolean(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: IssueCollector,
): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.add("invalid_type", `${path}.${key}`, `"${key}" must be a boolean`);
    return undefined;
  }
  return value;
}

/** Accepts any finite number; sign constraints are the caller's rule. */
function readOptionalNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: IssueCollector,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.add("not_finite_number", `${path}.${key}`, `"${key}" must be a finite number`);
    return undefined;
  }
  return value;
}

function readNonNegative(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: IssueCollector,
): number | undefined {
  const value = readOptionalNumber(source, key, path, issues);
  if (value === undefined) return undefined;
  if (value < 0) {
    issues.add("negative_number", `${path}.${key}`, `"${key}" must not be negative`);
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
  issues: IssueCollector,
): T | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    issues.add("invalid_type", `${path}.${key}`, `"${key}" must be a string`);
    return undefined;
  }
  if (!allowed.includes(value as T)) {
    issues.add(
      "unknown_enum_value",
      `${path}.${key}`,
      `"${key}" must be one of: ${allowed.join(", ")}`,
    );
    return undefined;
  }
  return value as T;
}

function rejectUnknownKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: IssueCollector,
): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) {
      issues.add("unknown_key", `${path}.${key}`, `unknown field "${key}"`);
    }
  }
}

function readModalities(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: IssueCollector,
): Modality[] | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.add("invalid_type", `${path}.${key}`, `"${key}" must be an array of modality names`);
    return undefined;
  }
  const modalities: Modality[] = [];
  value.forEach((entry, index) => {
    if (!isModality(entry)) {
      issues.add(
        "unknown_modality",
        `${path}.${key}[${index}]`,
        `unsupported modality: ${JSON.stringify(entry)}`,
      );
      return;
    }
    modalities.push(entry.trim().toLowerCase() as Modality);
  });
  return modalities;
}

/**
 * Validates the capabilities block.
 *
 * A declaration with no capabilities at all is an error, not a pass: an
 * operator who writes a `capabilities` key with nothing in it has not told us
 * the model can do anything, and treating that as "unknown" rather than "empty"
 * would hide the mistake.
 */
function readCapabilities(
  source: Record<string, unknown>,
  path: string,
  issues: IssueCollector,
): Record<string, unknown> | undefined {
  const value = source["capabilities"];
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.add("invalid_type", `${path}.capabilities`, `"capabilities" must be an object`);
    return undefined;
  }
  rejectUnknownKeys(value, CAPABILITY_KEYS, `${path}.capabilities`, issues);

  const capabilities: Record<string, unknown> = {};

  const inputModalities = readModalities(value, "inputModalities", `${path}.capabilities`, issues);
  if (inputModalities !== undefined) capabilities["inputModalities"] = inputModalities;

  const outputModalities = readModalities(value, "outputModalities", `${path}.capabilities`, issues);
  if (outputModalities !== undefined) capabilities["outputModalities"] = outputModalities;

  for (const key of CAPABILITY_KEYS) {
    if (key === "inputModalities" || key === "outputModalities") continue;
    const flag = readOptionalBoolean(value, key, `${path}.capabilities`, issues);
    if (flag !== undefined) capabilities[key] = flag;
  }

  if (Object.keys(capabilities).length === 0) {
    issues.add(
      "empty_capabilities",
      `${path}.capabilities`,
      '"capabilities" states nothing; omit the key instead of declaring an empty block',
    );
    return undefined;
  }
  return capabilities;
}

function readPricing(
  source: Record<string, unknown>,
  path: string,
  issues: IssueCollector,
): Partial<ModelPricing> | undefined {
  const value = source["pricing"];
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.add("invalid_type", `${path}.pricing`, `"pricing" must be an object`);
    return undefined;
  }
  rejectUnknownKeys(value, PRICING_KEYS, `${path}.pricing`, issues);

  const pricing: Record<string, unknown> = {};
  const tier = readEnum(value, "tier", `${path}.pricing`, PRICING_TIERS, issues);
  if (tier !== undefined) pricing["tier"] = tier;

  for (const key of ["inputPerMillionTokens", "outputPerMillionTokens"] as const) {
    const amount = readNonNegative(value, key, `${path}.pricing`, issues);
    if (amount !== undefined) pricing[key] = amount;
  }
  return Object.keys(pricing).length === 0 ? undefined : (pricing as Partial<ModelPricing>);
}

function readContext(
  source: Record<string, unknown>,
  path: string,
  issues: IssueCollector,
): Partial<ModelContextInfo> | undefined {
  const value = source["context"];
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.add("invalid_type", `${path}.context`, `"context" must be an object`);
    return undefined;
  }
  rejectUnknownKeys(value, CONTEXT_KEYS, `${path}.context`, issues);

  const context: Record<string, unknown> = {};
  for (const key of ["contextWindowTokens", "maxOutputTokens"] as const) {
    const size = readNonNegative(value, key, `${path}.context`, issues);
    if (size !== undefined) context[key] = size;
  }
  const declaredSource = readEnum(value, "source", `${path}.context`, CONTEXT_SOURCES, issues);
  if (declaredSource !== undefined) context["source"] = declaredSource;

  // `maxOutputTokens` above `contextWindowTokens` is impossible; catching it
  // here stops a nonsense declaration from skewing cost and quality scoring.
  const window = context["contextWindowTokens"];
  const maxOut = context["maxOutputTokens"];
  if (typeof window === "number" && typeof maxOut === "number" && maxOut > window) {
    issues.add(
      "contradictory_context",
      `${path}.context.maxOutputTokens`,
      `maxOutputTokens (${maxOut}) exceeds contextWindowTokens (${window})`,
    );
  }
  return Object.keys(context).length === 0 ? undefined : (context as Partial<ModelContextInfo>);
}

function readTags(
  source: Record<string, unknown>,
  path: string,
  issues: IssueCollector,
): string[] | undefined {
  const value = source["tags"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.add("invalid_type", `${path}.tags`, `"tags" must be an array of strings`);
    return undefined;
  }
  const tags: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      issues.add("invalid_type", `${path}.tags[${index}]`, "tags must be non-empty strings");
      return;
    }
    tags.push(entry.trim());
  });
  return tags;
}

/**
 * Validates one declaration object.
 *
 * `enabled: true` combined with an availability that cannot answer a request is
 * contradictory, so it is rejected rather than resolved: an operator who wants
 * a model switched on is asserting it can serve traffic.
 */
export function validateModelDeclaration(
  input: unknown,
  path = "model",
): DeclarationResult {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("not_an_object", path, "declaration must be an object");
    return { ok: false, issues: issues.issues };
  }
  rejectUnknownKeys(input, DECLARATION_KEYS, path, issues);

  const provider = requireNonEmptyString(input, "provider", path, issues);
  const modelId = requireNonEmptyString(input, "modelId", path, issues);
  const displayName = readOptionalString(input, "displayName", path, issues);
  const enabled = readOptionalBoolean(input, "enabled", path, issues);
  const freeAllowance = readOptionalBoolean(input, "freeAllowance", path, issues);
  const priority = readOptionalNumber(input, "priority", path, issues);
  const availability = readEnum<DeclarableAvailability>(
    input,
    "availability",
    path,
    DECLARABLE_AVAILABILITIES,
    issues,
  );
  const capabilities = readCapabilities(input, path, issues);
  const pricing = readPricing(input, path, issues);
  const context = readContext(input, path, issues);
  const tags = readTags(input, path, issues);

  if (enabled === true && availability !== undefined && availability !== "available" && availability !== "degraded") {
    issues.add(
      "contradictory_availability",
      `${path}.enabled`,
      `enabled: true cannot be combined with availability "${availability}"; a model that cannot serve traffic must stay disabled`,
    );
  }

  /**
   * A free-allowance model is one the operator funds out of a zero-cost budget.
   * That only makes sense against metered rates: if the model is genuinely
   * zero-priced, it is `tier: "free"` and needs no allowance at all. Declaring
   * both is a contradiction, so it is rejected rather than silently resolved.
   */
  if (freeAllowance === true && pricing !== undefined && pricing.tier === "free") {
    issues.add(
      "contradictory_pricing",
      `${path}.freeAllowance`,
      `freeAllowance: true cannot be combined with pricing.tier "free"; a zero-priced model is free without an allowance`,
    );
  }

  /**
   * A free-allowance claim is only meaningful against rates the operator can
   * point at. Without both rates present, "the operator funds this" is
   * unverifiable and indistinguishable from an unpriced model, so it is
   * rejected rather than accepted: failing closed means an allowance cannot
   * substitute for a published price.
   */
  if (freeAllowance === true) {
    const input = pricing?.inputPerMillionTokens;
    const output = pricing?.outputPerMillionTokens;
    if (input === undefined || output === undefined) {
      issues.add(
        "contradictory_pricing",
        `${path}.freeAllowance`,
        "freeAllowance: true requires pricing.inputPerMillionTokens and pricing.outputPerMillionTokens to be declared",
      );
    }
  }

  if (!issues.ok || provider === undefined || modelId === undefined) {
    return { ok: false, issues: issues.issues };
  }

  const declaration: ModelDeclaration = {
    provider,
    modelId,
    ...(displayName === undefined ? {} : { displayName }),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(availability === undefined ? {} : { availability }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(freeAllowance === undefined ? {} : { freeAllowance }),
    ...(priority === undefined ? {} : { priority }),
    ...(pricing === undefined ? {} : { pricing }),
    ...(context === undefined ? {} : { context }),
    ...(tags === undefined ? {} : { tags }),
  };
  return { ok: true, declarations: [declaration] };
}

/**
 * Validates a whole declarations document.
 *
 * Accepts either a bare array of declarations or `{ "models": [...] }`. Every
 * issue in the document is collected before returning, so an operator sees all
 * the mistakes in one pass instead of fixing them one restart at a time.
 */
export function validateDeclarationDocument(input: unknown): DeclarationResult {
  const issues = new IssueCollector();
  let entries: readonly unknown[];

  if (Array.isArray(input)) {
    entries = input;
  } else if (isRecord(input)) {
    rejectUnknownKeys(input, ["models"], "$", issues);
    const models = input["models"];
    if (models === undefined) {
      issues.add("missing_field", "$.models", 'document must be an array or { "models": [...] }');
      return { ok: false, issues: issues.issues };
    }
    if (!Array.isArray(models)) {
      issues.add("invalid_type", "$.models", '"models" must be an array');
      return { ok: false, issues: issues.issues };
    }
    entries = models;
  } else {
    issues.add(
      "not_an_object",
      "$",
      "declarations must be an array or { models: [...] }",
    );
    return { ok: false, issues: issues.issues };
  }

  const declarations: ModelDeclaration[] = [];
  const seen = new Map<string, number>();

  entries.forEach((entry, index) => {
    const result = validateModelDeclaration(entry, `models[${index}]`);
    if (!result.ok) {
      issues.issues.push(...result.issues);
      return;
    }
    const declaration = result.declarations[0];
    if (declaration === undefined) return;
    // A JSON-encoded tuple cannot collide, unlike a joined string where a
    // provider id containing the separator would alias another model.
    const key = JSON.stringify([declaration.provider, declaration.modelId]);
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      issues.add(
        "duplicate_declaration",
        `models[${index}]`,
        `duplicate declaration for "${declaration.provider}/${declaration.modelId}" (first declared at models[${firstIndex}])`,
      );
      return;
    }
    seen.set(key, index);
    declarations.push(declaration);
  });

  return issues.ok ? { ok: true, declarations } : { ok: false, issues: issues.issues };
}

/** Formats issues for an operator-facing log line. Values are never echoed. */
export function formatDeclarationIssues(issues: readonly DeclarationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.code}: ${issue.message}`).join("; ");
}

/** Exported for tests and for callers that need to narrow an availability string. */
export function isDeclarableAvailability(value: unknown): value is DeclarableAvailability {
  return typeof value === "string" && (DECLARABLE_AVAILABILITIES as readonly string[]).includes(value);
}