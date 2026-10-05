import { indexDeclarations, type ModelDeclaration } from "./providers/model-declaration";
import type { ModelRef, ProviderId } from "./types";

/**
 * The validated, immutable set of declarations a deployment runs with.
 *
 * Building this is the only supported way to get declarations into the gateway.
 * Because every entry passed validation, the router can treat a lookup hit as
 * trustworthy configuration rather than re-checking types on each request.
 */
export class DeclarationSet {
  readonly #byProvider: ReadonlyMap<ProviderId, ReadonlyMap<string, ModelDeclaration>>;

  constructor(declarations: readonly ModelDeclaration[] = []) {
    // `indexDeclarations` rejects duplicate provider/model pairs, so the
    // invariant this class promises cannot be violated by construction.
    this.#byProvider = indexDeclarations(declarations);
  }

  /** Provider-qualified lookup. `undefined` means "undeclared", which is unknown. */
  get(provider: ProviderId, modelId: string): ModelDeclaration | undefined {
    return this.#byProvider.get(provider)?.get(modelId);
  }

  has(ref: ModelRef): boolean {
    return this.get(ref.provider, ref.modelId) !== undefined;
  }

  /** All declarations, ordered by provider then model id for stable output. */
  all(): readonly ModelDeclaration[] {
    const flattened: ModelDeclaration[] = [];
    for (const byModel of this.#byProvider.values()) {
      flattened.push(...byModel.values());
    }
    return flattened.sort((a, b) =>
      a.provider === b.provider
        ? a.modelId.localeCompare(b.modelId)
        : a.provider.localeCompare(b.provider),
    );
  }

  /** Declarations for one provider, in model-id order. */
  forProvider(provider: ProviderId): readonly ModelDeclaration[] {
    return this.all().filter((declaration) => declaration.provider === provider);
  }

  providers(): readonly ProviderId[] {
    return [...this.#byProvider.keys()].sort((a, b) => a.localeCompare(b));
  }

  get size(): number {
    let total = 0;
    for (const byModel of this.#byProvider.values()) total += byModel.size;
    return total;
  }

  /**
   * Declarations that name a provider the deployment does not know about.
   *
   * These are inert — they can never match a discovered model — so they are
   * reported for operator feedback rather than treated as errors. A typo'd
   * provider id is the most common configuration mistake and would otherwise
   * fail silently.
   */
  unknownProviders(known: readonly ProviderId[]): readonly ProviderId[] {
    return this.providers().filter((provider) => !known.includes(provider));
  }
}

export const EMPTY_DECLARATION_SET = new DeclarationSet();

export function createDeclarationSet(
  declarations: readonly ModelDeclaration[] = [],
): DeclarationSet {
  return new DeclarationSet(declarations);
}