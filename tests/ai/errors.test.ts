import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_ERROR_CODES,
  AiProviderError,
  invalidRequest,
  isAiProviderError,
  modelUnavailable,
  noEligibleModel,
  providerRequestFailed,
  providerUnavailable,
} from "@/lib/ai/errors";

describe("error codes", () => {
  it("exposes exactly the documented codes", () => {
    assert.deepEqual([...AI_ERROR_CODES], [
      "PROVIDER_UNAVAILABLE",
      "MODEL_UNAVAILABLE",
      "NO_ELIGIBLE_MODEL",
      "PROVIDER_REQUEST_FAILED",
      "INVALID_REQUEST",
    ]);
  });

  it("treats a bad request as never retryable", () => {
    // The same malformed input would fail identically, so advertising it as
    // retryable would only invite the client to resubmit it forever.
    const error = invalidRequest("`turns` must be an array");
    assert.equal(error.code, "INVALID_REQUEST");
    assert.equal(error.retryable, false);
    assert.equal(error.detail, "`turns` must be an array");
  });
});

describe("constructors", () => {
  it("providerUnavailable carries the provider and is not retryable", () => {
    const error = providerUnavailable("omniroute", "missing base url");
    assert.equal(error.code, "PROVIDER_UNAVAILABLE");
    assert.equal(error.provider, "omniroute");
    assert.equal(error.detail, "missing base url");
    assert.equal(error.retryable, false);
    assert.equal(error.modelId, undefined);
  });

  it("modelUnavailable carries both provider and model", () => {
    const error = modelUnavailable("freellmapi", "m1", "rejected: model-disabled");
    assert.equal(error.code, "MODEL_UNAVAILABLE");
    assert.equal(error.provider, "freellmapi");
    assert.equal(error.modelId, "m1");
    assert.equal(error.detail, "rejected: model-disabled");
  });

  it("noEligibleModel records the reason as detail", () => {
    const error = noEligibleModel("provider-unreachable: omniroute/m1");
    assert.equal(error.code, "NO_ELIGIBLE_MODEL");
    assert.equal(error.detail, "provider-unreachable: omniroute/m1");
  });

  it("providerRequestFailed folds the detail into the message and keeps the code stable", () => {
    const error = providerRequestFailed("omniroute", { status: 502, detail: "bad gateway" });
    assert.equal(error.code, "PROVIDER_REQUEST_FAILED");
    assert.equal(error.status, 502);
    assert.match(error.message, /bad gateway/);
    assert.match(error.message, /omniroute/);
  });
});

describe("retryability", () => {
  it("marks transient statuses retryable", () => {
    for (const status of [408, 429, 500, 502, 503]) {
      assert.equal(providerRequestFailed("p", { status }).retryable, true, `status ${status}`);
    }
  });

  it("marks client errors and missing status non-retryable", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(providerRequestFailed("p", { status }).retryable, false, `status ${status}`);
    }
    assert.equal(providerRequestFailed("p").retryable, false);
  });

  it("honours an explicit override", () => {
    assert.equal(providerRequestFailed("p", { status: 400, retryable: true }).retryable, true);
    assert.equal(providerRequestFailed("p", { status: 500, retryable: false }).retryable, false);
  });
});

describe("error identity", () => {
  it("is an Error instance with the class name preserved", () => {
    const error = new AiProviderError("NO_ELIGIBLE_MODEL", "nope");
    assert.ok(error instanceof Error);
    assert.ok(error instanceof AiProviderError);
    assert.equal(error.name, "AiProviderError");
  });

  it("serializes to a stable shape with explicit nulls", () => {
    const json = providerUnavailable("omniroute").toJSON();
    assert.deepEqual(json, {
      name: "AiProviderError",
      code: "PROVIDER_UNAVAILABLE",
      message: 'Provider "omniroute" is unavailable',
      provider: "omniroute",
      modelId: null,
      status: null,
      retryable: false,
      detail: null,
    });
  });

  it("recognizes its own instances and rejects lookalikes", () => {
    assert.equal(isAiProviderError(providerUnavailable("p")), true);
    assert.equal(isAiProviderError(new Error("boom")), false);
    assert.equal(isAiProviderError({ code: "PROVIDER_UNAVAILABLE" }), false);
    assert.equal(isAiProviderError(null), false);
  });
});