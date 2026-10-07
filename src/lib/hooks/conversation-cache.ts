import type { ConversationTurn } from "./use-conversation";

/**
 * The client-side conversation cache.
 *
 * A hand-rolled external store: it holds the turns of every
 * conversation opened this session, keyed by conversation id, so
 * opening a conversation again renders from the cache instead of
 * waiting for the network. `useConversation` subscribes to it with
 * `useSyncExternalStore`, which is the contract `subscribe` and
 * `getSnapshot` implement — the snapshot is a version counter that
 * changes only when an entry is written, so a subscriber never
 * observes a half-updated store.
 *
 * The cache is a read-through layer, not a second source of truth:
 * every open still revalidates against `GET /api/conversations/[id]`
 * in the background, and a conversation that just received an
 * answer updates its entry, so the cache converges on what the
 * server holds.
 */
export class ConversationCache {
  #entries = new Map<string, readonly ConversationTurn[]>();
  #loads = new Map<string, Promise<readonly ConversationTurn[]>>();
  #listeners = new Set<() => void>();
  #version = 0;

  /** Registers a `useSyncExternalStore` subscriber. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * The store's snapshot: a counter that is stable between writes
   * and changes on every write. `useSyncExternalStore` compares
   * snapshots by identity, so a write is the only thing that
   * re-renders a subscriber.
   */
  getSnapshot = (): number => this.#version;

  /**
   * The server snapshot for `useSyncExternalStore`.
   *
   * React requires one during server rendering: without it the
   * hook throws "Missing getServerSnapshot". The server build
   * and a fresh client share the same starting version — the
   * cache is created empty on each render — so this returns the
   * same value `getSnapshot` would, and the initial render can
   * never disagree with the client's first paint.
   */
  getServerSnapshot = (): number => this.#version;

  /** The cached turns for a conversation, or `undefined` when it has not been loaded yet. */
  getTurns(id: string): readonly ConversationTurn[] | undefined {
    return this.#entries.get(id);
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  /** True while a load for this conversation is in flight. */
  isPending(id: string): boolean {
    return this.#loads.has(id);
  }

  /** Caches the turns for a conversation and notifies subscribers. */
  setTurns(id: string, turns: readonly ConversationTurn[]): void {
    this.#entries.set(id, turns);
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  /**
   * Loads a conversation through `fetchTurns`, deduplicating
   * concurrent loads of the same id: a hover prefetch and the click
   * that follows it share one request. The result is cached whether
   * or not an entry existed before — opening a cached conversation
   * still revalidates it against the server — and the pending entry
   * is cleared on both success and failure, so a failed load is
   * retried by the next open.
   */
  load(
    id: string,
    fetchTurns: () => Promise<readonly ConversationTurn[]>,
  ): Promise<readonly ConversationTurn[]> {
    const pending = this.#loads.get(id);
    if (pending !== undefined) return pending;

    const load = fetchTurns()
      .then((turns) => {
        this.setTurns(id, turns);
        return turns;
      })
      .finally(() => {
        this.#loads.delete(id);
      });

    this.#loads.set(id, load);
    return load;
  }

  /**
   * Evicts a conversation and notifies subscribers.
   *
   * Deletion is the cache's only removal: a deleted
   * conversation must never render again, so its turns
   * are dropped rather than left for the next load to
   * revalidate. Evicting an unknown id is a no-op, so a
   * delete that races a cache miss costs nothing.
   */
  remove(id: string): void {
    const hadEntry = this.#entries.delete(id);
    const hadLoad = this.#loads.delete(id);
    if (!hadEntry && !hadLoad) return;

    this.#version += 1;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

/** The process-wide cache: one per tab, like the session it mirrors. */
export const conversationCache = new ConversationCache();
