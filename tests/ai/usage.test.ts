import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_STATUS, parseChatStreamEvent } from "@/lib/ai/chat-protocol";
import { AI_ERROR_CODES } from "@/lib/ai/errors";
import type { TokenUsage } from "@/lib/ai/types";
import {
  MONTHLY_FREE_POOL_TARGET_TOKENS,
  formatTokens,
  hasUsage,
  sumUsage,
  totalTokens,
} from "@/lib/ai/usage";

/**
 * The rule these tests exist to protect: ORVYN shows what a provider reported, or
 * says it does not know. No estimation, no defaults, no zero-filling.
 */

const reading = (input: number | null, output: number | null): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
});

describe("totalTokens", () => {
  it("adds both reported halves", () => {
    assert.equal(totalTokens(reading(12, 7)), 19);
    assert.equal(totalTokens(reading(0, 0)), 0);
  });

  it("has no total when either half is missing", () => {
    // Reporting 7 total when 12 input was never read would understate the cost.
    assert.equal(totalTokens(reading(null, 7)), null);
    assert.equal(totalTokens(reading(12, null)), null);
    assert.equal(totalTokens(reading(null, null)), null);
  });
});

describe("hasUsage", () => {
  it("distinguishes a real zero from an absent reading", () => {
    assert.equal(hasUsage(reading(0, 0)), true, "a reported zero is a measurement");
    assert.equal(hasUsage(reading(0, null)), true);
    assert.equal(hasUsage(reading(null, null)), false);
    assert.equal(hasUsage(null), false);
  });
});

describe("sumUsage", () => {
  it("adds complete readings", () => {
    assert.deepEqual(sumUsage([reading(10, 5), reading(20, 3)]), {
      inputTokens: 30,
      outputTokens: 8,
    });
  });

  it("reports a half as unknown rather than as the sum of the rest", () => {
    // Treating a missing side as 0 would make unreported usage look free.
    const total = sumUsage([reading(10, 5), reading(null, 3)]);
    assert.equal(total.inputTokens, null);
    assert.equal(total.outputTokens, 8);
  });

  it("returns zeroes for an empty history", () => {
    assert.deepEqual(sumUsage([]), { inputTokens: 0, outputTokens: 0 });
  });
});

describe("monthly free-pool target", () => {
  it("is ORVYN's own budget, expressed as a plain token count", () => {
    assert.equal(MONTHLY_FREE_POOL_TARGET_TOKENS, 10_000_000_000);
  });
});

describe("formatTokens", () => {
  it("groups digits without inventing a unit", () => {
    assert.equal(formatTokens(0), "0");
    assert.equal(formatTokens(1234), "1,234");
    assert.equal(formatTokens(10_000_000_000), "10,000,000,000");
  });
});

describe("done frame usage on the wire", () => {
  it("accepts a complete reading", () => {
    const event = parseChatStreamEvent({
      type: "done",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
    assert.deepEqual(event, {
      type: "done",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
  });

  it("reads an absent usage block as unavailable", () => {
    const event = parseChatStreamEvent({ type: "done", finishReason: "stop", usage: null });
    assert.equal(event?.type === "done" ? event.usage : null, null);
  });

  it("rejects a partial reading rather than filling the gap", () => {
    for (const usage of [
      { inputTokens: 12, outputTokens: 7 },
      { inputTokens: 12, totalTokens: 19 },
      { inputTokens: 12 },
      { inputTokens: null, outputTokens: 7, totalTokens: 7 },
    ]) {
      const event = parseChatStreamEvent({ type: "done", finishReason: "stop", usage });
      assert.equal(
        event?.type === "done" ? event.usage : "missing",
        null,
        `partial usage ${JSON.stringify(usage)} must not be shown`,
      );
    }
  });

  it("rejects non-numeric counts", () => {
    const event = parseChatStreamEvent({
      type: "done",
      finishReason: "stop",
      usage: { inputTokens: "12", outputTokens: 7, totalTokens: 19 },
    });
    assert.equal(event?.type === "done" ? event.usage : null, null);
  });
});

describe("ERROR_STATUS", () => {
  it("covers every error code the layer can produce", () => {
    assert.deepEqual(Object.keys(ERROR_STATUS).sort(), [...AI_ERROR_CODES].sort());
  });
});