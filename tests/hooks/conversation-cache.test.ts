import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConversationTurn } from "@/lib/hooks/use-conversation";
import { ConversationCache, conversationCache } from "@/lib/hooks/conversation-cache";

/**
 * The cache is an external store: `useSyncExternalStore`
 * consumers subscribe to it and re-render when the snapshot
 * changes. These tests pin the store contract the hook relies
 * on — stable snapshots between writes, a bump on every
 * write, one request per in-flight id, and a load that
 * revalidates rather than trusting what it already holds.
 */

function turnList(...texts: string[]): ConversationTurn[] {
  return texts.map((text, index) => ({
    id: `turn-${index}`,
    role: "user",
    text,
  }));
}

describe("conversation cache store", () => {
  it("stores turns by conversation id", () => {
    const cache = new ConversationCache();
    const turns = turnList("hello");

    assert.equal(cache.has("c1"), false);
    assert.equal(cache.getTurns("c1"), undefined);

    cache.setTurns("c1", turns);

    assert.equal(cache.has("c1"), true);
    assert.equal(cache.getTurns("c1"), turns);
    assert.equal(cache.getTurns("c2"), undefined);
  });

  it("keeps the snapshot stable between writes and bumps it on every write", () => {
    const cache = new ConversationCache();
    const first = cache.getSnapshot();
    assert.equal(cache.getSnapshot(), first, "no write means no new snapshot");

    cache.setTurns("c1", []);
    const second = cache.getSnapshot();
    assert.notEqual(second, first, "a write must produce a new snapshot");

    cache.setTurns("c2", []);
    assert.notEqual(cache.getSnapshot(), second);
  });

  it("notifies subscribers on writes only, and stops after unsubscribe", () => {
    const cache = new ConversationCache();
    const seen: number[] = [];
    const unsubscribe = cache.subscribe(() => {
      seen.push(cache.getSnapshot());
    });

    cache.setTurns("c1", []);
    cache.setTurns("c1", []);
    assert.deepEqual(seen, [1, 2]);

    unsubscribe();
    cache.setTurns("c2", []);
    assert.deepEqual(seen, [1, 2], "an unsubscribed listener must not fire");
  });

  it("deduplicates concurrent loads of one conversation", async () => {
    const cache = new ConversationCache();
    let requests = 0;
    const fetchTurns = async (): Promise<readonly ConversationTurn[]> => {
      requests += 1;
      return turnList("hello");
    };

    const [first, second] = await Promise.all([
      cache.load("c1", fetchTurns),
      cache.load("c1", fetchTurns),
    ]);

    assert.equal(requests, 1, "the second load must share the first request");
    assert.equal(first, second, "callers must receive the same turns");
    assert.equal(cache.has("c1"), true, "a completed load is cached");
    assert.equal(cache.isPending("c1"), false);
  });

  it("revalidates a cached conversation on the next load", async () => {
    const cache = new ConversationCache();
    let requests = 0;
    const fetchTurns = async (): Promise<readonly ConversationTurn[]> => {
      requests += 1;
      return turnList("hello");
    };

    await cache.load("c1", fetchTurns);
    await cache.load("c1", fetchTurns);

    assert.equal(
      requests,
      2,
      "an entry in the cache does not skip revalidation",
    );
  });

  it("clears a pending load when it fails so the next open retries", async () => {
    const cache = new ConversationCache();
    let shouldFail = true;
    const fetchTurns = async (): Promise<readonly ConversationTurn[]> => {
      if (shouldFail) throw new Error("failed_to_load");
      return turnList("hello");
    };

    await assert.rejects(
      () => cache.load("c1", fetchTurns),
      /failed_to_load/,
    );
    assert.equal(cache.isPending("c1"), false, "a failed load must not stay pending");
    assert.equal(cache.has("c1"), false, "a failed load must not cache anything");

    shouldFail = false;
    await cache.load("c1", fetchTurns);
    assert.equal(cache.has("c1"), true, "the next load retries");
  });

  it("evicts a conversation and notifies subscribers", () => {
    const cache = new ConversationCache();
    cache.setTurns("c1", turnList("hello"));
    const seen: number[] = [];
    const unsubscribe = cache.subscribe(() => {
      seen.push(cache.getSnapshot());
    });

    cache.remove("c1");

    assert.equal(cache.has("c1"), false, "a deleted conversation is evicted");
    assert.equal(cache.getTurns("c1"), undefined);
    assert.equal(seen.length, 1, "an eviction must notify subscribers");

    unsubscribe();
  });

  it("treats evicting an unknown conversation as a no-op", () => {
    const cache = new ConversationCache();
    const first = cache.getSnapshot();
    cache.remove("missing");
    assert.equal(
      cache.getSnapshot(),
      first,
      "no write means no new snapshot",
    );
  });

  it("exports one process-wide cache", () => {
    assert.ok(conversationCache instanceof ConversationCache);
  });
});
