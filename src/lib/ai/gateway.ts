/**
 * The gateway's job: aggregate what the registered providers report, decide
 * which models can serve a request, route deterministically, and translate
 * failures into `AiProviderError`.
 *
 * It never invents state. A provider that is not registered, not configured, or
 * unreachable is excluded from routing rather than being attempted, and no
 * call is made to a provider that failed pre-flight checks.
 */
import { isStreamable } from "./capabilities";
import {
  DEFAULT_ELIGIBILITY_POLICY,
  isPinnedModel,
  partitionByEligibility,
  policyForRequest,
  type EligibilityPolicy,
  type ProviderState,
  type RejectionReason,
} from "./eligibility";
import { modelUnavailable, noEligibleModel, providerUnavailable } from "./errors";
import type { ProviderRegistry } from "./registry";
import { rankCandidates } from "./router";
import type {
  ChatRequest,
  GenerationChunk,
  GenerationResult,
  ModelDescriptor,
  ModelRef,
  ProviderHealth,
  ProviderId,
  RoutingStrategy,
  StreamOptions,
} from "./types";

export interface GatewayOptions {
  readonly registry: ProviderRegistry;
  readonly policy?: EligibilityPolicy | undefined;
}

export interface CatalogEntry {
  readonly provider: ProviderId;
  readonly models: readonly ModelDescriptor[];
}

export interface Catalog {
  readonly entries: readonly CatalogEntry[];
  readonly health: ReadonlyMap<ProviderId, ProviderHealth>;
  readonly states: ReadonlyMap<ProviderId, ProviderState>;
  /** Models that passed every eligibility rule for this policy. */
  readonly eligible: readonly ModelDescriptor[];
  /** Rejected models with the rule that excluded them, for diagnostics. */
  readonly excluded: readonly { readonly model: ModelDescriptor; readonly reason: RejectionReason }[];
}

export interface SelectionResult {
  readonly model: ModelDescriptor;
  readonly candidates: readonly ModelDescriptor[];
}

export class AiGateway {
  readonly #registry: ProviderRegistry;
  readonly #policy: EligibilityPolicy;

  constructor(options: GatewayOptions) {
    this.#registry = options.registry;
    this.#policy = options.policy ?? DEFAULT_ELIGIBILITY_POLICY;
  }

  /**
   * Health for every registered provider.
   *
   * An unconfigured provider is reported down here rather than by asking it, so
   * the "never contact a provider with no credentials" rule holds centrally
   * instead of depending on each implementation to remember it.
   */
  async health(): Promise<ReadonlyMap<ProviderId, ProviderHealth>> {
    const checkedAt = new Date().toISOString();
    const entries = await Promise.all(
      this.#registry.list().map(async (provider) => {
        if (!provider.info.configured) {
          return [
            provider.info.id,
            {
              provider: provider.info.id,
              status: "down" as const,
              reachable: false,
              checkedAt,
              latencyMs: null,
              detail: provider.info.configurationDetail ?? "provider is not configured",
            },
          ] as const;
        }
        return [provider.info.id, await provider.healthCheck()] as const;
      }),
    );
    return new Map(entries);
  }

  /**
   * Aggregated view of the catalog: per-provider models plus health, with
   * ineligible models separated out and the reason recorded.
   */
  async catalog(policy: EligibilityPolicy = this.#policy): Promise<Catalog> {
    const health = await this.health();
    const configured = new Set(this.#registry.listConfigured().map((provider) => provider.info.id));

    const states = new Map<ProviderId, ProviderState>();
    for (const provider of this.#registry.list()) {
      states.set(provider.info.id, {
        configured: configured.has(provider.info.id),
        health: health.get(provider.info.id) ?? null,
      });
    }

    // Only configured providers are asked for models. An unconfigured provider
    // has no endpoint to ask.
    const modelsByProvider = await Promise.all(
      this.#registry
        .listConfigured()
        .map(async (provider) => [provider.info.id, await provider.listModels()] as const),
    );

    const entries: CatalogEntry[] = [];
    const allModels: ModelDescriptor[] = [];
    for (const [providerId, models] of modelsByProvider) {
      entries.push({ provider: providerId, models });
      allModels.push(...models);
    }

    const { eligible, rejected } = partitionByEligibility(allModels, states, policy);
    return { entries, health, states, eligible, excluded: rejected };
  }

  /**
   * Picks the model a request should use.
   *
   * A pinned model bypasses strategy selection but not eligibility: if the
   * caller pins something unusable, that is a `MODEL_UNAVAILABLE` naming the
   * pinned model, not a silent fall back to a different one.
   */
  async select(request: ChatRequest, policy?: EligibilityPolicy): Promise<SelectionResult> {
    const base = policy ?? this.#policy;
    const effective = policyForRequest(request, base);
    const catalog = await this.catalog(effective);
    const eligible = catalog.eligible;

    if (request.pinnedModel !== undefined) {
      return this.#selectPinned(request, catalog, eligible, effective);
    }

    if (eligible.length === 0) {
      throw noEligibleModel(describeExclusions(catalog.excluded));
    }

    const strategy: RoutingStrategy = request.strategy ?? "balanced";
    const ranked = rankCandidates(eligible, strategy, request, catalog.health);
    const chosen = ranked[0];
    if (chosen === undefined) throw noEligibleModel("ranking produced no candidate");
    return { model: chosen.model, candidates: eligible };
  }

  /**
   * Every eligible model, best first.
   *
   * `select` answers "which one" for a single-shot call. This answers "in what
   * order should we try them", which is what a caller needs in order to fall
   * back when a provider times out or rate-limits: the list is the ranked
   * preference order, so a retry is always the next-best model rather than an
   * arbitrary one.
   *
   * Eligibility is resolved once, here. A caller walking this list must not
   * re-probe the catalog between attempts — re-probing would hide the failure it
   * is trying to route around.
   *
   * @throws AiProviderError `NO_ELIGIBLE_MODEL` when nothing is eligible.
   */
  async rankedCandidates(
    request: ChatRequest,
    policy?: EligibilityPolicy,
  ): Promise<readonly ModelDescriptor[]> {
    const base = policy ?? this.#policy;
    const effective = policyForRequest(request, base);
    const catalog = await this.catalog(effective);

    if (request.pinnedModel !== undefined) {
      // A pinned request has exactly one permitted target, so returning it as a
      // single-element list lets fallback code stay uniform without ever
      // substituting a different model behind the caller's back.
      return [this.#selectPinned(request, catalog, catalog.eligible, effective).model];
    }

    const strategy: RoutingStrategy = request.strategy ?? "balanced";
    return rankCandidates(catalog.eligible, strategy, request, catalog.health).map(
      (candidate) => candidate.model,
    );
  }

  async generate(request: ChatRequest, policy?: EligibilityPolicy): Promise<GenerationResult> {
    const { model } = await this.select(request, policy);
    const provider = this.#requireProvider(model.provider);
    return provider.generate(request, { provider: model.provider, modelId: model.modelId });
  }

  /**
   * Streamed completion.
   *
   * An async generator is lazy, so nothing runs until the caller iterates — and
   * model selection happens before the first chunk is pulled. An ineligible
   * model therefore fails immediately rather than failing mid-stream.
   */
  async *stream(
    request: ChatRequest,
    policy?: EligibilityPolicy,
    options?: StreamOptions,
  ): AsyncGenerator<GenerationChunk> {
    const { model } = await this.select({ ...request, requireStreaming: true }, policy);
    yield* this.streamSelected(model, request, options);
  }

  /**
   * Streams an already-selected model, skipping a second selection pass.
   *
   * This exists because selection has to be able to fail *before* a caller
   * commits a response. A lazy `stream()` cannot do that: its failure surfaces
   * only once iteration starts, by which point the status code is already sent
   * and the failure has to be reported in-band instead.
   *
   * The caller is responsible for having obtained `model` from `select`. The
   * streaming capability gate is still enforced here, so a model that cannot
   * stream is rejected even though eligibility was not re-checked.
   */
  async *streamSelected(
    model: ModelDescriptor,
    request: ChatRequest,
    options?: StreamOptions,
  ): AsyncGenerator<GenerationChunk> {
    if (!isStreamable(model.capabilities)) {
      throw modelUnavailable(
        model.provider,
        model.modelId,
        "model does not support streaming",
      );
    }
    const provider = this.#requireProvider(model.provider);
    const ref: ModelRef = { provider: model.provider, modelId: model.modelId };
    for await (const chunk of provider.stream(request, ref, options)) {
      yield chunk;
    }
  }

  #requireProvider(providerId: ProviderId) {
    const provider = this.#registry.get(providerId);
    if (provider === undefined) throw providerUnavailable(providerId, "provider is not registered");
    return provider;
  }

  #selectPinned(
    request: ChatRequest,
    catalog: Catalog,
    eligible: readonly ModelDescriptor[],
    policy: EligibilityPolicy,
  ): SelectionResult {
    const pinned = request.pinnedModel as ModelRef;
    const match = eligible.find((model) => isPinnedModel(model, pinned));
    if (match !== undefined) return { model: match, candidates: eligible };

    // Report why the pinned model failed rather than falling back silently.
    const state = catalog.states.get(pinned.provider);
    if (state === undefined || !state.configured) {
      throw providerUnavailable(pinned.provider, "pinned model's provider is not configured");
    }
    if (state.health === null || !state.health.reachable) {
      throw providerUnavailable(pinned.provider, "pinned model's provider is unreachable");
    }
    const excluded = catalog.excluded.find((entry) => isPinnedModel(entry.model, pinned));
    throw modelUnavailable(
      pinned.provider,
      pinned.modelId,
      excluded === undefined ? `not eligible under policy (${policy.requireStreaming ? "streaming required" : "default policy"})` : `rejected: ${excluded.reason}`,
    );
  }
}

/**
 * Turns rejections into an operator-readable summary. Only the reason codes
 * and provider/model ids are included — never request content or credentials.
 */
export function describeExclusions(
  excluded: readonly { readonly model: ModelDescriptor; readonly reason: RejectionReason }[],
): string {
  if (excluded.length === 0) return "no providers are registered or configured";
  const summary = new Map<RejectionReason, string[]>();
  for (const entry of excluded) {
    const label = `${entry.model.provider}/${entry.model.modelId}`;
    const bucket = summary.get(entry.reason);
    if (bucket === undefined) summary.set(entry.reason, [label]);
    else bucket.push(label);
  }
  return [...summary.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, labels]) => `${reason}: ${labels.join(", ")}`)
    .join("; ");
}

export function createAiGateway(options: GatewayOptions): AiGateway {
  return new AiGateway(options);
}