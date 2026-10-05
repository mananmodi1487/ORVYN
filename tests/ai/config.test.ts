import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getProviderEnvSpec,
  normalizeBaseUrl,
  PROVIDER_ENV_SPECS,
  PROVIDER_IDS,
  resolveAllProviderConfigs,
  resolveProviderConfig,
} from "@/lib/ai/config";

const OMNIROUTE = getProviderEnvSpec("omniroute");
const FREELLM = getProviderEnvSpec("freellmapi");

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("provider environment specs", () => {
  it("covers every configured gateway", () => {
    assert.deepEqual([...PROVIDER_IDS], ["omniroute", "freellmapi", "groq"]);
  });

  it("names the non-public variables, so no key can be prefixed for the browser", () => {
    for (const spec of PROVIDER_ENV_SPECS) {
      assert.match(spec.baseUrlVar, /^[A-Z_]+$/);
      assert.match(spec.apiKeyVar, /^[A-Z_]+$/);
      assert.equal(spec.baseUrlVar.startsWith("NEXT_PUBLIC_"), false);
      assert.equal(spec.apiKeyVar.startsWith("NEXT_PUBLIC_"), false);
    }
  });

  it("has a Groq spec pointing at the OpenAI-compatible endpoint", () => {
    const groq = getProviderEnvSpec("groq");
    assert.equal(groq.baseUrlVar, "GROQ_BASE_URL");
    assert.equal(groq.apiKeyVar, "GROQ_API_KEY");
    assert.equal(groq.displayName, "Groq");
  });
});

describe("resolveProviderConfig", () => {
  it("returns the resolved config when both values are present", () => {
    const result = resolveProviderConfig(
      OMNIROUTE,
      env({ OMNIROUTE_BASE_URL: "https://api.example.test/v1", OMNIROUTE_API_KEY: "secret" }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.baseUrl, "https://api.example.test/v1");
    assert.equal(result.config.apiKey, "secret");
    assert.equal(result.config.id, "omniroute");
  });

  it("reports the missing variable by name", () => {
    const result = resolveProviderConfig(OMNIROUTE, env({ OMNIROUTE_BASE_URL: "https://x.test" }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /OMNIROUTE_API_KEY/);
    assert.match(result.reason, /not configured/);
  });

  it("treats blank and whitespace-only values as missing", () => {
    const result = resolveProviderConfig(
      FREELLM,
      env({ FREE_LLM_API_BASE_URL: "   ", FREE_LLM_API_KEY: "" }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /FREE_LLM_API_BASE_URL/);
    assert.match(result.reason, /FREE_LLM_API_KEY/);
  });

  it("requires the pair: a base url with no key is not usable", () => {
    const result = resolveProviderConfig(OMNIROUTE, env({ OMNIROUTE_BASE_URL: "https://x.test" }));
    assert.equal(result.ok, false);
  });

  it("never echoes a key value into the failure reason", () => {
    const result = resolveProviderConfig(
      OMNIROUTE,
      env({ OMNIROUTE_BASE_URL: "https://x.test", OMNIROUTE_API_KEY: "super-secret" }),
    );
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(resolveAllProviderConfigs(env({})));
    assert.equal(serialized.includes("super-secret"), false);
  });
});

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes so endpoint joining cannot double them", () => {
    assert.equal(normalizeBaseUrl("https://x.test/v1/"), "https://x.test/v1");
    assert.equal(normalizeBaseUrl("https://x.test/v1///"), "https://x.test/v1");
  });

  it("keeps a path prefix, which some gateways require", () => {
    assert.equal(normalizeBaseUrl("https://x.test/openai/v1"), "https://x.test/openai/v1");
  });

  it("rejects a relative or malformed url", () => {
    assert.throws(() => normalizeBaseUrl("not a url"), /not a valid absolute URL/);
    assert.throws(() => normalizeBaseUrl("/v1"), /not a valid absolute URL/);
  });

  it("rejects a non-http scheme", () => {
    assert.throws(() => normalizeBaseUrl("ftp://x.test"), /must use http or https/);
  });
});

describe("resolveAllProviderConfigs", () => {
  it("reports each provider independently", () => {
    const results = resolveAllProviderConfigs(
      env({ OMNIROUTE_BASE_URL: "https://a.test", OMNIROUTE_API_KEY: "k1" }),
    );
    assert.equal(results.get("omniroute")?.ok, true);
    assert.equal(results.get("freellmapi")?.ok, false);
  });
});