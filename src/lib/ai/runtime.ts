/**
 * Server-side composition root for the AI layer.
 *
 * Only composition code may build a gateway. This is the single place in the
 * app that does, so provider registration, credential resolution, and declaration
 * loading cannot drift between call sites.
 *
 * The instance is cached per server process: providers are stateless and
 * declarations are read once from the environment, so there is nothing to gain
 * from rebuilding per request and a registry to lose.
 */
import { loadDeclarationSetOrEmpty } from "./declaration-loader";
import { createAiGateway, type AiGateway } from "./gateway";
import { createGatewayProviders } from "./providers/index";
import { createProviderRegistry } from "./registry";
import { assertServerOnly } from "./server-only";

let cached: AiGateway | null = null;

/**
 * The process-wide gateway.
 *
 * Safe to call before any credential is configured: unconfigured providers are
 * created as `configured: false` and are then never contacted, so this returns
 * a usable gateway that reports "no eligible model" rather than throwing.
 *
 * The validated declaration set is handed to the gateway as well as to the
 * providers, which makes declarations the catalog on the routing path: a chat
 * request never asks a provider for its model list, and health is probed at
 * most once per TTL window instead of once per request.
 */
export function getAiGateway(): AiGateway {
  assertServerOnly("@/lib/ai/runtime");
  if (cached !== null) return cached;

  const declarations = loadDeclarationSetOrEmpty();
  const providers = createGatewayProviders({ declarations });
  cached = createAiGateway({
    registry: createProviderRegistry(providers),
    declarations,
  });
  return cached;
}

/** Test seam: drops the cached gateway so the next call rebuilds it. */
export function resetAiGateway(): void {
  cached = null;
}
