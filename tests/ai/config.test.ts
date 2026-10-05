import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const CLOUDFLARE = getProviderEnvSpec("cloudflare");

  function env(values: Record<string, string>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
  }

describe("provider environment specs", () => {
  it("covers every configured gateway", () => {
    assert.deepEqual([...PROVIDER_IDS], ["cloudflare", "omniroute", "freellmapi", "groq", "pollinations"]);
  });

  it("names the non-public variables, so no key can be prefixed for the browser", () => {
    for (const spec of PROVIDER_ENV_SPECS) {
      assert.match(spec.baseUrlVar, /^[A-Z_]+$/);
      assert.match(spec.apiKeyVar, /^[A-Z_]+$/);
      assert.equal(spec.baseUrlVar.startsWith("NEXT_PUBLIC_"), false);
      assert.equal(spec.apiKeyVar.startsWith("NEXT_PUBLIC_"), false);
      if (spec.accountIdVar !== undefined) {
        assert.match(spec.accountIdVar, /^[A-Z_]+$/);
        assert.equal(spec.accountIdVar.startsWith("NEXT_PUBLIC_"), false);
      }
    }
  });

  it("has a Cloudflare spec with an account id variable", () => {
    const cloudflare = getProviderEnvSpec("cloudflare");
    assert.equal(cloudflare.baseUrlVar, "CLOUDFLARE_BASE_URL");
    assert.equal(cloudflare.apiKeyVar, "CLOUDFLARE_API_TOKEN");
    assert.equal(cloudflare.accountIdVar, "CLOUDFLARE_ACCOUNT_ID");
    assert.equal(cloudflare.displayName, "Cloudflare");
  });

  it("has a Pollinations spec pointing at the OpenAI-compatible gateway", () => {
    const pollinations = getProviderEnvSpec("pollinations");
    assert.equal(pollinations.baseUrlVar, "POLLINATIONS_BASE_URL");
    assert.equal(pollinations.apiKeyVar, "POLLINATIONS_API_KEY");
    assert.equal(pollinations.displayName, "Pollinations");
  });

  it("documents the Pollinations base URL in the env template", () => {
    // The template must carry the documented default so a deployer can copy it
    // without looking up the URL separately.
    const template = readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf8",
    );
    assert.match(template, /POLLINATIONS_BASE_URL=https:\/\/gen\.pollinations\.ai\/v1/);
    assert.match(template, /POLLINATIONS_API_KEY=/);
    // The template may mention key *types* for documentation — "sk_" is a
    // prefix, not a key. What it must not contain is an actual key value: a
    // non-empty string after the POLLINATIONS_API_KEY assignment.
    const line = template
      .split("\n")
      .find((l) => l.trim().startsWith("POLLINATIONS_API_KEY="));
    assert.ok(line !== undefined, "POLLINATIONS_API_KEY line must exist");
    const value = line.split("=").slice(1).join("=");
    assert.equal(
      value.trim(),
      "",
      "the template must not ship a real Pollinations API key",
    );
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

  it("requires the account id for Cloudflare, since the URL embeds it", () => {
    const result = resolveProviderConfig(
      CLOUDFLARE,
      env({
        CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_API_TOKEN: "tok",
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /CLOUDFLARE_ACCOUNT_ID/);
  });

  it("carries the account id through when all three are present", () => {
    const result = resolveProviderConfig(
      CLOUDFLARE,
      env({
        CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_ACCOUNT_ID: "abc123",
        CLOUDFLARE_API_TOKEN: "tok",
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.accountId, "abc123");
    assert.equal(result.config.apiKey, "tok");
  });

  it("never echoes the token into a failure reason", () => {
    const serialized = JSON.stringify(
      resolveAllProviderConfigs(
        env({
          CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
          CLOUDFLARE_ACCOUNT_ID: "abc123",
          CLOUDFLARE_API_TOKEN: "super-secret",
        }),
      ),
    );
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