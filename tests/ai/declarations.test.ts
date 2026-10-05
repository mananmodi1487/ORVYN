import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DECLARATION_ISSUE_CODES,
  formatDeclarationIssues,
  isDeclarableAvailability,
  validateDeclarationDocument,
  validateModelDeclaration,
  type DeclarationIssue,
} from "@/lib/ai/declaration-schema";
import { DeclarationSet, createDeclarationSet } from "@/lib/ai/declarations";
import {
  DECLARATIONS_JSON_VAR,
  DECLARATIONS_PATH_VAR,
  loadDeclarationsFromEnv,
  loadDeclarationsFromFile,
  loadDeclarationsFromJson,
} from "@/lib/ai/declaration-loader";
import { describeModel, indexDeclarations, type ModelDeclaration } from "@/lib/ai/providers/model-declaration";
import type { ModelDescriptor } from "@/lib/ai/types";

/** A minimal, complete, valid declaration. */
function validDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "omniroute",
    modelId: "chat-large",
    displayName: "Chat Large",
    availability: "available",
    enabled: true,
    priority: 10,
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsStreaming: true,
      supportsSystemPrompt: true,
    },
    pricing: { tier: "paid", inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
    context: { contextWindowTokens: 200_000, maxOutputTokens: 8_000 },
    ...overrides,
  };
}

function issuesOf(input: unknown): readonly DeclarationIssue[] {
  const result = validateModelDeclaration(input);
  assert.equal(result.ok, false, "expected the declaration to be rejected");
  if (result.ok) return [];
  return result.issues;
}

function codesOf(issues: readonly DeclarationIssue[]): readonly string[] {
  return issues.map((issue) => issue.code);
}

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

// --------------------------------------------------------------------------
// Valid declaration
// --------------------------------------------------------------------------

describe("valid declaration", () => {
  it("accepts a complete declaration and preserves every field", () => {
    const result = validateModelDeclaration(validDeclaration());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const [declaration] = result.declarations;
    assert.equal(declaration?.provider, "omniroute");
    assert.equal(declaration?.modelId, "chat-large");
    assert.equal(declaration?.displayName, "Chat Large");
    assert.equal(declaration?.availability, "available");
    assert.equal(declaration?.enabled, true);
    assert.equal(declaration?.priority, 10);
    assert.deepEqual(declaration?.capabilities, {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsStreaming: true,
      supportsSystemPrompt: true,
    });
    assert.deepEqual(declaration?.pricing, {
      tier: "paid",
      inputPerMillionTokens: 3,
      outputPerMillionTokens: 15,
    });
    assert.deepEqual(declaration?.context, {
      contextWindowTokens: 200_000,
      maxOutputTokens: 8_000,
    });
  });

  it("requires only provider and modelId", () => {
    const result = validateModelDeclaration({ provider: "omniroute", modelId: "m" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Omitted fields must be absent, never defaulted to an invented value.
    assert.deepEqual(result.declarations[0], { provider: "omniroute", modelId: "m" });
  });

  it("accepts a vision model that also does text", () => {
    const result = validateModelDeclaration(
      validDeclaration({
        capabilities: {
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          supportsStreaming: true,
        },
      }),
    );
    assert.equal(result.ok, true);
  });

  it("normalises modality casing and rejects unknown modalities", () => {
    const ok = validateModelDeclaration(
      validDeclaration({
        capabilities: { inputModalities: [" TEXT "], outputModalities: ["Text"] },
      }),
    );
    assert.equal(ok.ok, true);

    const bad = issuesOf(
      validDeclaration({ capabilities: { inputModalities: ["text", "vision"] } }),
    );
    assert.ok(codesOf(bad).includes("unknown_modality"));
  });

  it("accepts both document shapes: bare array and { models: [...] }", () => {
    const asArray = validateDeclarationDocument([validDeclaration()]);
    const asObject = validateDeclarationDocument({ models: [validDeclaration()] });
    assert.equal(asArray.ok, true);
    assert.equal(asObject.ok, true);
    if (!asArray.ok || !asObject.ok) return;
    assert.equal(asArray.declarations.length, 1);
    assert.deepEqual(asArray.declarations, asObject.declarations);
  });

  it("accepts an empty document as an empty set", () => {
    const result = validateDeclarationDocument([]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.declarations, []);
  });
});

// --------------------------------------------------------------------------
// Invalid declaration
// --------------------------------------------------------------------------

describe("invalid declaration", () => {
  it("rejects a non-object", () => {
    assert.deepEqual(codesOf(issuesOf("chat-large")), ["not_an_object"]);
    assert.deepEqual(codesOf(issuesOf(null)), ["not_an_object"]);
    assert.deepEqual(codesOf(issuesOf([])), ["not_an_object"]);
  });

  it("requires provider and modelId", () => {
    assert.ok(codesOf(issuesOf({ modelId: "m" })).includes("missing_field"));
    assert.ok(codesOf(issuesOf({ provider: "omniroute" })).includes("missing_field"));
  });

  it("rejects empty and whitespace-only identifiers", () => {
    assert.ok(codesOf(issuesOf(validDeclaration({ modelId: "" }))).includes("empty_string"));
    assert.ok(codesOf(issuesOf(validDeclaration({ provider: "   " }))).includes("empty_string"));
  });

  it("rejects wrong types rather than coercing them", () => {
    assert.ok(codesOf(issuesOf(validDeclaration({ enabled: "yes" }))).includes("invalid_type"));
    assert.ok(codesOf(issuesOf(validDeclaration({ priority: "high" }))).includes("not_finite_number"));
    assert.ok(codesOf(issuesOf(validDeclaration({ tags: "a,b" }))).includes("invalid_type"));
    assert.ok(codesOf(issuesOf(validDeclaration({ pricing: 3 }))).includes("invalid_type"));
  });

  it("rejects unknown keys, so a typo cannot be silently ignored", () => {
    const issues = issuesOf(validDeclaration({ inputModalites: ["text"] }));
    assert.ok(codesOf(issues).includes("unknown_key"));
    const unknownKey = issues.find((issue) => issue.code === "unknown_key");
    assert.equal(unknownKey?.path, "model.inputModalites");
  });

  it("rejects unknown keys inside capabilities, pricing, and context", () => {
    assert.ok(
      codesOf(issuesOf(validDeclaration({ capabilities: { supportsStream: true } }))).includes(
        "unknown_key",
      ),
    );
    assert.ok(
      codesOf(issuesOf(validDeclaration({ pricing: { tier: "paid", perMillion: 1 } }))).includes(
        "unknown_key",
      ),
    );
    assert.ok(
      codesOf(issuesOf(validDeclaration({ context: { window: 1000 } }))).includes("unknown_key"),
    );
  });

  it("rejects an unrecognised enum value and lists the allowed set", () => {
    const issues = issuesOf(validDeclaration({ availability: "sometimes" }));
    assert.ok(codesOf(issues).includes("unknown_enum_value"));
    assert.match(issues.find((issue) => issue.code === "unknown_enum_value")?.message ?? "", /available/);

    assert.ok(codesOf(issuesOf(validDeclaration({ pricing: { tier: "cheap" } }))).includes(
      "unknown_enum_value",
    ));
    assert.ok(
      codesOf(issuesOf(validDeclaration({ context: { source: "guesswork" } }))).includes(
        "unknown_enum_value",
      ),
    );
  });

  it("rejects negative money and token counts", () => {
    assert.ok(
      codesOf(issuesOf(validDeclaration({ pricing: { inputPerMillionTokens: -1 } }))).includes(
        "negative_number",
      ),
    );
    assert.ok(
      codesOf(issuesOf(validDeclaration({ context: { contextWindowTokens: -5 } }))).includes(
        "negative_number",
      ),
    );
  });

  it("rejects a capabilities block that states nothing", () => {
    const issues = issuesOf(validDeclaration({ capabilities: {} }));
    assert.ok(codesOf(issues).includes("empty_capabilities"));
  });

  it("rejects enabled:true combined with an availability that cannot serve traffic", () => {
    for (const availability of ["unavailable", "retired"]) {
      const issues = issuesOf(validDeclaration({ availability, enabled: true }));
      assert.ok(
        codesOf(issues).includes("contradictory_availability"),
        `availability ${availability} should conflict with enabled:true`,
      );
    }
    // A degraded model can still answer, so that combination is allowed.
    const degraded = validateModelDeclaration(
      validDeclaration({ availability: "degraded", enabled: true }),
    );
    assert.equal(degraded.ok, true);
  });

  it("rejects a context whose max output exceeds its window", () => {
    const issues = issuesOf(
      validDeclaration({ context: { contextWindowTokens: 1000, maxOutputTokens: 2000 } }),
    );
    assert.ok(codesOf(issues).includes("contradictory_context"));
  });

  it("rejects duplicate declarations in one document and names both positions", () => {
    const result = validateDeclarationDocument([validDeclaration(), validDeclaration()]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const duplicate = result.issues.find((issue) => issue.code === "duplicate_declaration");
    assert.equal(duplicate?.path, "models[1]");
    assert.match(duplicate?.message ?? "", /first declared at models\[0\]/);
  });

  it("collects every issue in a document, not just the first", () => {
    const result = validateDeclarationDocument([
      validDeclaration({ modelId: "" }),
      validDeclaration({ modelId: "m2", priority: "high" }),
      validDeclaration({ modelId: "m3", enabled: "yes" }),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues.length, 3);
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ["models[0].modelId", "models[1].priority", "models[2].enabled"],
    );
  });

  it("rejects a document that is neither an array nor a models object", () => {
    assert.equal(validateDeclarationDocument("nope").ok, false);
    assert.equal(validateDeclarationDocument({ models: {} }).ok, false);
    assert.equal(validateDeclarationDocument({}).ok, false);
  });

  it("exposes issue codes as data and never echoes a configuration value", () => {
    assert.ok(DECLARATION_ISSUE_CODES.includes("contradictory_availability"));
    const issues = issuesOf(validDeclaration({ availability: "sometimes" }));
    const summary = formatDeclarationIssues(issues);
    assert.match(summary, /unknown_enum_value/);
    // The operator's own value appears in the message for enums, but no field
    // that could hold a secret is ever interpolated.
    assert.equal(summary.includes("OMNIROUTE_API_KEY"), false);
  });

  it("narrows availability strings for callers", () => {
    assert.equal(isDeclarableAvailability("available"), true);
    assert.equal(isDeclarableAvailability("unknown"), false);
    assert.equal(isDeclarableAvailability(7), false);
  });
});

// --------------------------------------------------------------------------
// DeclarationSet
// --------------------------------------------------------------------------

describe("DeclarationSet", () => {
  const declaration: ModelDeclaration = { provider: "omniroute", modelId: "m1" };

  it("looks up by provider and model id together", () => {
    const set = createDeclarationSet([declaration]);
    assert.equal(set.get("omniroute", "m1"), declaration);
    assert.equal(set.get("freellmapi", "m1"), undefined, "same id on another provider must not match");
    assert.equal(set.has({ provider: "omniroute", modelId: "m1" }), true);
  });

  it("rejects duplicates on construction", () => {
    assert.throws(() => createDeclarationSet([declaration, declaration]), /Duplicate model declaration/);
  });

  it("returns a stable order regardless of insertion order", () => {
    const set = createDeclarationSet([
      { provider: "b", modelId: "z" },
      { provider: "a", modelId: "y" },
      { provider: "a", modelId: "x" },
    ]);
    assert.deepEqual(
      set.all().map((entry) => `${entry.provider}/${entry.modelId}`),
      ["a/x", "a/y", "b/z"],
    );
    assert.deepEqual(set.providers(), ["a", "b"]);
  });

  it("filters by provider, which is how adapters receive their slice", () => {
    const set = createDeclarationSet([
      { provider: "omniroute", modelId: "a" },
      { provider: "freellmapi", modelId: "b" },
    ]);
    assert.deepEqual(
      set.forProvider("omniroute").map((entry) => entry.modelId),
      ["a"],
    );
  });

  it("reports declarations aimed at providers the deployment does not have", () => {
    const set = createDeclarationSet([{ provider: "typo-provider", modelId: "m" }]);
    assert.deepEqual(set.unknownProviders(["omniroute", "freellmapi"]), ["typo-provider"]);
    assert.deepEqual(set.unknownProviders(["typo-provider"]), []);
  });

  it("starts empty", () => {
    assert.equal(new DeclarationSet().size, 0);
  });
});

// --------------------------------------------------------------------------
// Merge into descriptors
// --------------------------------------------------------------------------

describe("undeclared metadata stays unknown", () => {
  it("leaves every undisclosed field unknown for an undeclared model", () => {
    const model = describeModel("omniroute", "mystery", indexDeclarations([]));
    assert.equal(model.availability, "unknown");
    assert.equal(model.enabled, false);
    assert.equal(model.priority, 0);
    assert.equal(model.displayName, "mystery");
    assert.deepEqual(model.capabilities.inputModalities, []);
    assert.deepEqual(model.capabilities.outputModalities, []);
    assert.equal(model.capabilities.supportsStreaming, false);
    assert.equal(model.pricing.tier, "unknown");
    assert.equal(model.pricing.inputPerMillionTokens, null);
    assert.equal(model.context.contextWindowTokens, null);
    assert.equal(model.context.source, "unknown");
    assert.deepEqual(model.tags, []);
  });

  it("keeps omitted fields unknown even in a partial declaration", () => {
    const index = indexDeclarations([
      { provider: "omniroute", modelId: "m", displayName: "Only A Name" },
    ]);
    const model = describeModel("omniroute", "m", index);
    assert.equal(model.displayName, "Only A Name");
    // Nothing else was declared, so nothing else is claimed.
    assert.equal(model.pricing.tier, "unknown");
    assert.equal(model.context.source, "unknown");
    assert.deepEqual(model.capabilities.outputModalities, []);
    assert.equal(model.enabled, false);
  });

  it("never applies a declaration meant for a different provider", () => {
    const index = indexDeclarations([
      { provider: "omniroute", modelId: "shared", enabled: true, displayName: "Omni's" },
    ]);
    const model = describeModel("freellmapi", "shared", index);
    assert.equal(model.enabled, false);
    assert.equal(model.displayName, "shared");
  });

  it("honours an explicitly declared availability", () => {
    const index = indexDeclarations([
      { provider: "omniroute", modelId: "retired", availability: "retired" },
      { provider: "omniroute", modelId: "degraded", availability: "degraded" },
    ]);
    assert.equal(describeModel("omniroute", "retired", index).availability, "retired");
    assert.equal(describeModel("omniroute", "degraded", index).availability, "degraded");
  });

  it("marks context as declared when the operator supplied limits", () => {
    const index = indexDeclarations([
      {
        provider: "omniroute",
        modelId: "m",
        context: { contextWindowTokens: 1000, maxOutputTokens: 100 },
      },
    ]);
    const model = describeModel("omniroute", "m", index);
    assert.equal(model.context.source, "declared");
    assert.equal(model.context.contextWindowTokens, 1000);
  });
});

// --------------------------------------------------------------------------
// Server-only loading
// --------------------------------------------------------------------------

describe("declaration loading", () => {
  it("loads from an inline JSON env variable", () => {
    const result = loadDeclarationsFromEnv(
      env({ [DECLARATIONS_JSON_VAR]: JSON.stringify([validDeclaration()]) }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source.kind, "json");
    assert.equal(result.set.size, 1);
  });

  it("treats unset and blank variables as no declarations", () => {
    for (const value of [undefined, "", "   "]) {
      const result = loadDeclarationsFromEnv(
        env(value === undefined ? {} : { [DECLARATIONS_JSON_VAR]: value }),
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.source.kind, "empty");
      assert.equal(result.set.size, 0);
    }
  });

  it("prefers an explicit file path over inline JSON", () => {
    const result = loadDeclarationsFromEnv(
      env({
        [DECLARATIONS_PATH_VAR]: "",
        [DECLARATIONS_JSON_VAR]: JSON.stringify([validDeclaration()]),
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // A blank path must not mask the inline document.
    assert.equal(result.source.kind, "json");
  });

  it("reports malformed JSON as an issue rather than throwing", () => {
    const result = loadDeclarationsFromJson("{ not json");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.source.kind, "json");
    assert.match(result.summary, /not valid JSON/);
  });

  it("propagates validation issues from an inline document", () => {
    const result = loadDeclarationsFromJson(JSON.stringify([{ provider: "p" }]));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.code === "missing_field"));
  });

  it("reports a missing file instead of throwing", () => {
    const result = loadDeclarationsFromFile("does-not-exist.json");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.source.kind, "file");
    assert.match(result.summary, /could not be read/);
  });

  it("rejects a blank file path", () => {
    const result = loadDeclarationsFromFile("   ");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.code === "empty_string"));
  });

  it("refuses to run in a browser-like environment", () => {
    const globals = globalThis as { window?: unknown };
    globals.window = {};
    try {
      assert.throws(() => loadDeclarationsFromJson("[]"), /server-only/);
      assert.throws(() => loadDeclarationsFromFile("ai.models.json"), /server-only/);
      assert.throws(() => loadDeclarationsFromEnv(env({})), /server-only/);
    } finally {
      delete globals.window;
    }
  });

  it("uses variable names that cannot be inlined into the browser bundle", () => {
    assert.equal(DECLARATIONS_PATH_VAR.startsWith("NEXT_PUBLIC_"), false);
    assert.equal(DECLARATIONS_JSON_VAR.startsWith("NEXT_PUBLIC_"), false);
  });
});

// --------------------------------------------------------------------------
// End-to-end: declarations through the descriptor into the catalog
// --------------------------------------------------------------------------

describe("descriptor projection", () => {
  function descriptorFrom(input: unknown, modelId = "chat-large"): ModelDescriptor {
    const result = validateModelDeclaration(input);
    if (!result.ok) throw new Error("fixture declaration must be valid");
    const [declaration] = result.declarations;
    if (declaration === undefined) throw new Error("no declaration produced");
    return describeModel(declaration.provider, modelId, indexDeclarations(result.declarations));
  }

  it("projects every declared field onto the descriptor", () => {
    const model = descriptorFrom(validDeclaration());
    assert.equal(model.provider, "omniroute");
    assert.equal(model.modelId, "chat-large");
    assert.equal(model.displayName, "Chat Large");
    assert.equal(model.availability, "available");
    assert.equal(model.enabled, true);
    assert.equal(model.priority, 10);
    assert.equal(model.pricing.tier, "paid");
    assert.equal(model.pricing.outputPerMillionTokens, 15);
    assert.equal(model.context.contextWindowTokens, 200_000);
  });

  it("gives an undeclared model a priority of zero, so it cannot win a tiebreak", () => {
    const model = describeModel("omniroute", "ghost", indexDeclarations([]));
    assert.equal(model.priority, 0);
  });
});

afterEach(() => {
  const globals = globalThis as { window?: unknown };
  delete globals.window;
});