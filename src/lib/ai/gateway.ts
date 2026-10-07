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
import type { DeclarationSet } from "./declarations";
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
  /**
   * Operator-validated model declarations. When present they are the
   * catalog: the routing path never asks a provider for its model
   * list, because a `/models` response carries no capabilities, price,
   * or context limits — only declarations do. When absent, the gateway
   * falls back to asking each configured provider, which is the path
   * tests and ad-hoc composition use.
   */
  readonly declarations?: DeclarationSet | undefined;
  /**
   * How long one health observation stays trusted before the next
   * request re-probes. Health is a provider-level signal that changes
   * on the scale of seconds, not milliseconds; probing it on every
   * chat request put N upstream round trips on the critical path
   * before the first token. Defaults to 20 seconds.
   */
  readonly healthTtlMs?: number | undefined;
  /** Clock, injectable so tests can advance past the TTL. */
  readonly now?: (() => number) | undefined;
}

/** Default trust window for one health observation. */
export const DEFAULT_HEALTH_TTL_MS = 20_000;

/** One health observation and the moment it was taken. */
interface HealthSnapshot {
  readonly observedAt: number;
  readonly health: ReadonlyMap<ProviderId, ProviderHealth>;
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
  readonly #declarations: DeclarationSet | undefined;
  readonly #healthTtlMs: number;
  readonly #now: () => number;
  #healthSnapshot: HealthSnapshot | null = null;
  #healthProbe: Promise<ReadonlyMap<ProviderId, ProviderHealth>> | null = null;

  constructor(options: GatewayOptions) {
    this.#registry = options.registry;
    this.#policy = options.policy ?? DEFAULT_ELIGIBILITY_POLICY;
    this.#declarations = options.declarations;
    this.#healthTtlMs = options.healthTtlMs ?? DEFAULT_HEALTH_TTL_MS;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Health for every registered provider.
   *
   * An unconfigured provider is reported down here rather than by asking it, so
   * the "never contact a provider with no credentials" rule holds centrally
   * instead of depending on each implementation to remember it.
   *
   * Observations are cached for `healthTtlMs`: health is a coarse, slow-moving
   * signal, and re-probing it on every chat request cost an upstream round trip
   * per provider before the first token. Concurrent callers share one in-flight
   * probe instead of each starting their own.
   */
  async health(): Promise<ReadonlyMap<ProviderId, ProviderHealth>> {
    const snapshot = this.#healthSnapshot;
    if (snapshot !== null && this.#now() - snapshot.observedAt < this.#healthTtlMs) {
      return snapshot.health;
    }
    const inFlight = this.#healthProbe;
    if (inFlight !== null) return inFlight;

    const probe = this.#probeHealth();
    this.#healthProbe = probe;
    try {
      const health = await probe;
      this.#healthSnapshot = { observedAt: this.#now(), health };
      return health;
    } finally {
      this.#healthProbe = null;
    }
  }

  /**
   * Explicit operator refresh: probes every provider now, bypassing the
   * TTL cache. Nothing on the routing path calls this — it is the escape
   * hatch for an operator who needs fresh health immediately, such as
   * after a configuration change.
   */
  async refreshHealth(): Promise<ReadonlyMap<ProviderId, ProviderHealth>> {
    const health = await this.#probeHealth();
    this.#healthSnapshot = { observedAt: this.#now(), health };
    return health;
  }

  /** Probes every registered provider. Unconfigured providers report down. */
  async #probeHealth(): Promise<ReadonlyMap<ProviderId, ProviderHealth>> {
    const checkedAt = new Date(this.#now()).toISOString();
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
   *
   * When declarations were supplied at construction they are the model
   * source: no provider is asked for its model list on the routing path,
   * because only declarations carry capabilities, pricing, and context
   * limits. Without declarations the gateway asks each configured provider,
   * which is the legacy path ad-hoc composition relies on.
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

    const declarations = this.#declarations;
    let entries: CatalogEntry[];
    let allModels: readonly ModelDescriptor[];
    if (declarations !== undefined) {
      entries = this.#registry.listConfigured().map((provider) => ({
        provider: provider.info.id,
        models: declarations.describeForProvider(provider.info.id),
      }));
      // Declarations for providers that are not registered or not
      // configured are included on purpose: partitioning then reports
      // *why* they cannot serve — `provider-not-registered` or
      // `provider-not-configured` — which is exactly the diagnosis
      // an operator needs.
      allModels = declarations.describeAll();
    } else {
      entries = await this.#listModelsFromProviders();
      allModels = entries.flatMap((entry) => [...entry.models]);
    }

    const { eligible, rejected } = partitionByEligibility(allModels, states, policy);
    return { entries, health, states, eligible, excluded: rejected };
  }

  /**
   * Explicit operator discovery: asks every configured provider for the
   * model ids it reports right now. Nothing on the routing path calls
   * this — declarations are the source of truth for routing — so an
   * operator uses it to compare what a provider reports against what is
   * declared, and to notice a model that was added upstream but never
   * declared (and is therefore not routable).
   */
  async discoverModels(): Promise<readonly CatalogEntry[]> {
    return this.#listModelsFromProviders();
  }

  /** Asks each configured provider for its model list. */
  async #listModelsFromProviders(): Promise<CatalogEntry[]> {
    const modelsByProvider = await Promise.all(
      this.#registry
        .listConfigured()
        .map(async (provider) => [provider.info.id, await provider.listModels()] as const),
    );
    return modelsByProvider.map(([provider, models]) => ({ provider, models }));
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
   * The caller also receives the models that were rejected and why. Throwing
   * that away used to mean the only signal a caller got was "no free model is
   * eligible", which is true in every failing configuration and useless for
   * diagnosing one. The exclusions are computed alongside the ranking at no extra
   * cost, so there is no reason not to hand them over.
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

  /**
   * The models that were rejected and why, for the same request `rankedCandidates`
   * would have considered.
   *
   * Split out rather than folded into `rankedCandidates`'s return type so the
   * happy path keeps its single-shape contract. The failure path is where this
   * matters: "no free model is eligible" is true in every broken configuration, so
   * saying it alone is not a diagnosis. What an operator needs is the reason code
   * for each candidate — `provider-not-configured`, `model-disabled`,
   * `unknown-pricing`, and so on.
   *
   * Recomputes the catalog, which is acceptable: this is only ever called when
   * routing has already failed, never on the happy path.
   */
  async catalogExclusions(
    request: ChatRequest,
    policy?: EligibilityPolicy,
  ): Promise<readonly { readonly model: ModelDescriptor; readonly reason: RejectionReason }[]> {
    const base = policy ?? this.#policy;
    const effective = policyForRequest(request, base);
    const catalog = await this.catalog(effective);
    return catalog.excluded;
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