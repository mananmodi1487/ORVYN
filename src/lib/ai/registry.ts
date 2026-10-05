import type { AiProvider, AiProviderInfo } from "./provider";
import type { ProviderId } from "./types";

/**
 * Explicit registry.
 *
 * Nothing self-registers on import: a provider only becomes routable because
 * code chose to hand it to the registry. That keeps the set of live providers
 * reviewable and makes tests independent of module load order.
 */
export class ProviderRegistry {
  readonly #providers = new Map<ProviderId, AiProvider>();

  register(provider: AiProvider): this {
    const id = provider.info.id;
    if (id.trim() === "") throw new Error("Provider id must not be empty");
    if (this.#providers.has(id)) throw new Error(`Provider "${id}" is already registered`);
    this.#providers.set(id, provider);
    return this;
  }

  get(id: ProviderId): AiProvider | undefined {
    return this.#providers.get(id);
  }

  has(id: ProviderId): boolean {
    return this.#providers.has(id);
  }

  list(): readonly AiProvider[] {
    // Sorted so catalog output and gateway iteration order are stable.
    return [...this.#providers.values()].sort((a, b) => a.info.id.localeCompare(b.info.id));
  }

  /** Only providers that have credentials or a base URL configured. */
  listConfigured(): readonly AiProvider[] {
    return this.list().filter((provider) => provider.info.configured);
  }

  infos(): readonly AiProviderInfo[] {
    return this.list().map((provider) => provider.info);
  }

  get size(): number {
    return this.#providers.size;
  }
}

export function createProviderRegistry(providers: readonly AiProvider[] = []): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const provider of providers) registry.register(provider);
  return registry;
}