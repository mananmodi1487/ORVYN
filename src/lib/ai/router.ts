import { costScore } from "./pricing";
import type {
  ChatRequest,
  ModelDescriptor,
  ProviderHealth,
  ProviderId,
  RoutingStrategy,
} from "./types";

/**
 * A quality prior derived only from what a provider declared. ORVYN has no
 * benchmark harness of its own, so this must never imply a measured ranking:
 * `quality:<tier>` tags are the provider's own claim, and context window is a
 * weak proxy for capacity, not for answer quality.
 */
const QUALITY_TIERS = ["frontier", "advanced", "standard", "basic"] as const;
type QualityTier = (typeof QUALITY_TIERS)[number];

const DEFAULT_QUALITY_TIER: QualityTier = "standard";

function qualityTier(model: ModelDescriptor): QualityTier {
  for (const tier of QUALITY_TIERS) {
    if (model.tags.includes(`quality:${tier}`)) return tier;
  }
  return DEFAULT_QUALITY_TIER;
}

function qualityScore(model: ModelDescriptor): number {
  const declared = QUALITY_TIERS.length - QUALITY_TIERS.indexOf(qualityTier(model));
  const context = model.context.contextWindowTokens;
  const capacity = context === null ? 0 : Math.min(context / 1_000_000, 1);
  return declared + capacity;
}

/**
 * Latency is a provider-level observation, so it is deliberately coarse. A
 * provider we have not measured gets no credit — an unknown is never treated as
 * fast.
 */
function latencyScore(model: ModelDescriptor, health: ReadonlyMap<ProviderId, ProviderHealth>): number {
  const measured = health.get(model.provider)?.latencyMs;
  return measured === null || measured === undefined ? Number.POSITIVE_INFINITY : measured;
}

/**
 * Min-max normalizes a raw measurement into 0..1 across the current candidate
 * set, so latency in milliseconds can be blended with cost in dollars. Returns
 * `null` when the dimension cannot be scored, letting the caller fall back to a
 * neutral value instead of silently rewarding an unknown.
 */
function normalize(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (max === min) return 0;
  return (value - min) / (max - min);
}

interface DimensionRange {
  readonly min: number;
  readonly max: number;
}

function rangeOf(values: readonly number[]): DimensionRange {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/**
 * Neutral value used when a dimension is unmeasurable for every candidate.
 * Weighting these equally keeps the blend stable instead of rewarding a model
 * merely for having no data.
 */
const NEUTRAL_DIMENSION = 0.5;

/**
 * Stable final tiebreak. Two candidates that score identically always resolve
 * the same way, so routing stays reproducible across processes and runs.
 */
function tiebreakKey(model: ModelDescriptor): string {
  return `${model.provider}::${model.modelId}`;
}

export interface RankedCandidate {
  readonly model: ModelDescriptor;
  readonly score: number;
}

/**
 * Per-candidate-set context the `balanced` blend needs. Latency is in
 * milliseconds and cost in dollars, so both must be normalized over the
 * candidate set before they can be combined.
 */
interface ScoringContext {
  readonly health: ReadonlyMap<ProviderId, ProviderHealth>;
  readonly latencyRange: DimensionRange;
  readonly costRange: DimensionRange;
  readonly qualityRange: DimensionRange;
}

function buildScoringContext(
  candidates: readonly ModelDescriptor[],
  request: ChatRequest,
  health: ReadonlyMap<ProviderId, ProviderHealth>,
): ScoringContext {
  return {
    health,
    latencyRange: rangeOf(candidates.map((model) => latencyScore(model, health))),
    costRange: rangeOf(candidates.map((model) => costScore(model, request))),
    qualityRange: rangeOf(candidates.map((model) => qualityScore(model))),
  };
}

/**
 * Weights for `balanced`. Latency dominates because it is the only dimension
 * measured directly from our own probes; quality carries the least weight
 * because it is a declared prior, not a benchmark result.
 */
const BALANCED_WEIGHTS = { latency: 0.45, cost: 0.35, quality: 0.2 } as const;

/**
 * Lower score wins for every strategy. One comparator per strategy keeps the
 * "deterministic and testable" requirement honest: no strategy is a silent
 * reordering of another.
 */
export function scoreForStrategy(
  model: ModelDescriptor,
  strategy: RoutingStrategy,
  request: ChatRequest,
  context: ScoringContext,
): number {
  switch (strategy) {
    case "lowest-latency":
      return latencyScore(model, context.health);
    case "lowest-cost":
      return costScore(model, request);
    case "highest-quality":
      return -qualityScore(model);
    case "balanced": {
      const latency =
        normalize(latencyScore(model, context.health), context.latencyRange.min, context.latencyRange.max) ??
        NEUTRAL_DIMENSION;
      const cost =
        normalize(costScore(model, request), context.costRange.min, context.costRange.max) ??
        NEUTRAL_DIMENSION;
      const quality =
        normalize(qualityScore(model), context.qualityRange.min, context.qualityRange.max) ??
        NEUTRAL_DIMENSION;
      return (
        latency * BALANCED_WEIGHTS.latency +
        cost * BALANCED_WEIGHTS.cost +
        (1 - quality) * BALANCED_WEIGHTS.quality
      );
    }
  }
}

/**
 * Ranks already-eligible candidates. Eligibility is the caller's job; the
 * router only decides among models that passed.
 */
export function rankCandidates(
  candidates: readonly ModelDescriptor[],
  strategy: RoutingStrategy,
  request: ChatRequest,
  health: ReadonlyMap<ProviderId, ProviderHealth>,
): readonly RankedCandidate[] {
  const context = buildScoringContext(candidates, request, health);
  return candidates
    .map((model) => ({ model, score: scoreForStrategy(model, strategy, request, context) }))
    .sort((a, b) => {
      // Unscored candidates (unknown latency or unpriced cost) always sink
      // below scored ones — an unknown never wins for being unknown.
      const finiteA = Number.isFinite(a.score) ? 0 : 1;
      const finiteB = Number.isFinite(b.score) ? 0 : 1;
      if (finiteA !== finiteB) return finiteA - finiteB;
      if (a.score !== b.score) return a.score - b.score;
      return tiebreakKey(a.model).localeCompare(tiebreakKey(b.model));
    });
}

/** The single model a request should use, or `null` when none is available. */
export function selectModel(
  candidates: readonly ModelDescriptor[],
  strategy: RoutingStrategy,
  request: ChatRequest,
  health: ReadonlyMap<ProviderId, ProviderHealth>,
): ModelDescriptor | null {
  const ranked = rankCandidates(candidates, strategy, request, health);
  return ranked[0]?.model ?? null;
}