import { assertServerOnly } from "./server-only";

/**
 * Environment-backed provider configuration.
 *
 * Resolution is deferred to call time, mirroring `utils/supabase/env.ts`, so a
 * missing variable produces an actionable message instead of breaking
 * `next build`. All of these variables are deliberately *not*
 * `NEXT_PUBLIC_`-prefixed: a prefixed value is inlined into the browser bundle,
 * which would ship every provider key to clients.
 */

export const PROVIDER_IDS = ["omniroute", "freellmapi", "groq", "pollinations"] as const;
export type ConfigurableProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderEnvSpec {
  readonly id: ConfigurableProviderId;
  readonly displayName: string;
  readonly baseUrlVar: string;
  readonly apiKeyVar: string;
}

export const PROVIDER_ENV_SPECS: readonly ProviderEnvSpec[] = [
  {
    id: "omniroute",
    displayName: "OmniRoute",
    baseUrlVar: "OMNIROUTE_BASE_URL",
    apiKeyVar: "OMNIROUTE_API_KEY",
  },
  {
    id: "freellmapi",
    displayName: "FreeLLMAPI",
    baseUrlVar: "FREE_LLM_API_BASE_URL",
    apiKeyVar: "FREE_LLM_API_KEY",
  },
  {
    id: "groq",
    displayName: "Groq",
    baseUrlVar: "GROQ_BASE_URL",
    apiKeyVar: "GROQ_API_KEY",
  },
  {
    id: "pollinations",
    displayName: "Pollinations",
    baseUrlVar: "POLLINATIONS_BASE_URL",
    apiKeyVar: "POLLINATIONS_API_KEY",
  },
];

/** Looks up a provider's env spec by id. Throws for an id we do not support. */
export function getProviderEnvSpec(id: ConfigurableProviderId): ProviderEnvSpec {
  const spec = PROVIDER_ENV_SPECS.find((entry) => entry.id === id);
  if (spec === undefined) throw new Error(`Unknown AI provider: ${id}`);
  return spec;
}

export interface ResolvedProviderConfig {
  readonly id: ConfigurableProviderId;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

export type ProviderConfigResult =
  | { readonly ok: true; readonly config: ResolvedProviderConfig }
  | { readonly ok: false; readonly reason: string };

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function describeMissing(spec: ProviderEnvSpec, missing: readonly string[]): string {
  const names = missing.map((name) => `\`${name}\``).join(" and ");
  return `${spec.displayName} is not configured. Set ${names} in .env.local (see .env.example), then restart the dev server.`;
}

/**
 * Resolves one provider's configuration.
 *
 * Both values are required together: a base URL without a key would send
 * unauthenticated requests, and a key without a base URL has nowhere to go.
 */
export function resolveProviderConfig(
  spec: ProviderEnvSpec,
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfigResult {
  assertServerOnly("resolveProviderConfig");

  const baseUrl = clean(env[spec.baseUrlVar]);
  const apiKey = clean(env[spec.apiKeyVar]);

  const missing: string[] = [];
  if (baseUrl === undefined) missing.push(spec.baseUrlVar);
  if (apiKey === undefined) missing.push(spec.apiKeyVar);
  if (baseUrl === undefined || apiKey === undefined) {
    return { ok: false, reason: describeMissing(spec, missing) };
  }

  return {
    ok: true,
    config: {
      id: spec.id,
      displayName: spec.displayName,
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey,
    },
  };
}

/**
 * Strips trailing slashes so endpoint joining never produces a double slash,
 * and rejects anything that is not an absolute http(s) URL.
 */
export function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`AI provider base URL is not a valid absolute URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`AI provider base URL must use http or https, received: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function resolveAllProviderConfigs(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyMap<ConfigurableProviderId, ProviderConfigResult> {
  assertServerOnly("resolveAllProviderConfigs");
  const results = new Map<ConfigurableProviderId, ProviderConfigResult>();
  for (const spec of PROVIDER_ENV_SPECS) {
    results.set(spec.id, resolveProviderConfig(spec, env));
  }
  return results;
}