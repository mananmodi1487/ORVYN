import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProviderRegistry, createProviderRegistry } from "@/lib/ai/registry";
import { createFakeProvider, makeModel } from "./fixtures/fake-provider";

describe("ProviderRegistry", () => {
  it("returns providers in a stable id order regardless of registration order", () => {
    const registry = createProviderRegistry([
      createFakeProvider({ id: "c" }),
      createFakeProvider({ id: "a" }),
      createFakeProvider({ id: "b" }),
    ]);
    assert.deepEqual(
      registry.list().map((provider) => provider.info.id),
      ["a", "b", "c"],
    );
  });

  it("looks providers up by id", () => {
    const provider = createFakeProvider({ id: "p" });
    const registry = createProviderRegistry([provider]);
    assert.equal(registry.get("p"), provider);
    assert.equal(registry.get("missing"), undefined);
    assert.equal(registry.has("p"), true);
  });

  it("rejects a duplicate id instead of silently replacing a provider", () => {
    const registry = createProviderRegistry([createFakeProvider({ id: "p" })]);
    assert.throws(() => registry.register(createFakeProvider({ id: "p" })), /already registered/);
  });

  it("rejects an empty id", () => {
    assert.throws(
      () => new ProviderRegistry().register(createFakeProvider({ id: "  " })),
      /must not be empty/,
    );
  });

  it("separates configured providers from unconfigured ones", () => {
    const registry = createProviderRegistry([
      createFakeProvider({ id: "on", models: [makeModel({ provider: "on", modelId: "m" })] }),
      createFakeProvider({ id: "off", configured: false }),
    ]);
    assert.deepEqual(
      registry.listConfigured().map((provider) => provider.info.id),
      ["on"],
    );
    assert.equal(registry.list().length, 2);
  });

  it("starts empty", () => {
    const registry = createProviderRegistry();
    assert.equal(registry.size, 0);
    assert.deepEqual(registry.infos(), []);
  });
});