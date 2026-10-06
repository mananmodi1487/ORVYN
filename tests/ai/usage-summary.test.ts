import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UNAVAILABLE_SUMMARY, readTotals } from "@/lib/ai/usage-store";
import type { UsageTotals } from "@/lib/ai/usage";

/**
 * `readTotals` parses the aggregate rows the Supabase RPCs return. The bug it
 * guards against is a type-shape mismatch: PostgreSQL `bigint`/`int8` aggregates
 * arrive as decimal strings, and a strict `typeof value === "number"` check
 * rejected every real total, so the UI fell back to "usage unavailable" even
 * though the RPCs executed fine.
 */

function row(inputTokens: unknown, outputTokens: unknown, requestCount: unknown) {
  return [
    { input_tokens: inputTokens, output_tokens: outputTokens, request_count: requestCount },
  ];
}

describe("readTotals accepts PostgreSQL bigint strings", () => {
  it("reads aggregate values returned as decimal strings", () => {
    const totals = readTotals(row("1204", "88", "7"), null) as UsageTotals;
    assert.deepEqual(totals, {
      inputTokens: 1204,
      outputTokens: 88,
      totalTokens: 1292,
      requestCount: 7,
    });
  });

  it("reads normal numeric values", () => {
    const totals = readTotals(row(1204, 88, 7), null) as UsageTotals;
    assert.deepEqual(totals, {
      inputTokens: 1204,
      outputTokens: 88,
      totalTokens: 1292,
      requestCount: 7,
    });
  });

  it("accepts large bigint strings that are still safe integers", () => {
    const totals = readTotals(row("9007199254740991", "1", "3"), null) as UsageTotals;
    assert.equal(totals.inputTokens, 9007199254740991);
    assert.equal(totals.totalTokens, 9007199254740992);
  });

  it("rejects a bigint string that exceeds Number.MAX_SAFE_INTEGER", () => {
    assert.equal(readTotals(row("9007199254740992", "0", "1"), null), null);
  });

  it("rejects fractional values, whether numeric or string", () => {
    assert.equal(readTotals(row(1.5, 0, 1), null), null);
    assert.equal(readTotals(row("1.5", 0, 1), null), null);
  });

  it("rejects negative values, whether numeric or string", () => {
    assert.equal(readTotals(row(-1, 0, 1), null), null);
    assert.equal(readTotals(row("-3", 0, 1), null), null);
  });

  it("rejects non-numeric strings, booleans, null and undefined", () => {
    for (const value of ["abc", "1,000", "0x10", true, null, undefined]) {
      assert.equal(
        readTotals(row(value, 0, 1), null),
        null,
        `value ${JSON.stringify(value)} must be rejected`,
      );
    }
  });

  it("rejects whitespace-padded strings", () => {
    assert.equal(readTotals(row("  1204  ", 0, 1), null), null);
  });

  it("rejects an empty string as a zero", () => {
    assert.equal(readTotals(row("", 0, 1), null), null);
  });

  it("returns null when any column is missing", () => {
    assert.equal(readTotals(row(1204, 88, null), null), null);
    assert.equal(readTotals([{ input_tokens: 1204, output_tokens: 88 }], null), null);
  });

  it("returns null when the RPC errored", () => {
    assert.equal(readTotals(null, { message: "denied" }), null);
  });

  it("returns null for an empty result set", () => {
    assert.equal(readTotals([], null), null);
  });

  it("returns null for a non-object row", () => {
    assert.equal(readTotals([42], null), null);
    assert.equal(readTotals([null], null), null);
  });

  it("returns null for a non-array payload", () => {
    assert.equal(readTotals({ input_tokens: 1, output_tokens: 1, request_count: 1 }, null), null);
  });
});

describe("UNAVAILABLE_SUMMARY", () => {
  it("carries null totals and the operator's own monthly target", () => {
    assert.equal(UNAVAILABLE_SUMMARY.userDaily, null);
    assert.equal(UNAVAILABLE_SUMMARY.globalMonth, null);
    assert.equal(typeof UNAVAILABLE_SUMMARY.monthlyTargetTokens, "number");
    assert.ok(UNAVAILABLE_SUMMARY.monthlyTargetTokens > 0);
  });
});