import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The chat gate is an authorization decision, so it is worth pinning structurally.
 *
 * These assertions read the source rather than importing it because the property
 * under test is *where in the handler* the check happens and *what it imports*.
 * A behavioural test would pass just as happily against a handler that checked the
 * session after calling a provider, which is precisely the mistake being guarded
 * against.
 */

const route = readFileSync(
  new URL("../../src/app/api/chat/route.ts", import.meta.url),
  "utf8",
);

/** Offset of the `requireUser()` call within the handler body. */
function offsetOf(needle: string): number {
  const at = route.indexOf(needle);
  assert.notEqual(at, -1, `expected to find ${needle} in the chat route`);
  return at;
}

describe("POST /api/chat requires a session", () => {
  it("calls requireUser and returns 401 for an anonymous request", () => {
    assert.match(route, /import \{ requireUser, unauthorizedResponse \} from "@\/lib\/auth\/guard";/);
    assert.match(route, /const auth = await requireUser\(\);/);
    assert.match(route, /if \(!auth\.allowed\) return unauthorizedResponse\(\);/);
  });

  it("checks the session before reading the body or contacting a provider", () => {
    // Ordering is the whole point. A gate placed after the body is read still lets
    // an anonymous client upload up to `MAX_BODY_BYTES`; placed after routing, it
    // has already spent an upstream call.
    const gate = offsetOf("const auth = await requireUser()");
    const body = offsetOf("parseChatRequest(await readJsonBody(request))");
    const gateway = offsetOf("const gateway = getAiGateway()");
    const candidates = offsetOf("await gateway.rankedCandidates(chatRequest)");

    assert.ok(gate < body, "the gate must precede reading the request body");
    assert.ok(gate < gateway, "the gate must precede building the gateway");
    assert.ok(gate < candidates, "the gate must precede resolving model candidates");
  });

  it("answers 401 rather than redirecting or throwing", () => {
    // A redirect would hand the browser an HTML login page where the client
    // expects a stream frame, and the error contract would be lost.
    const guard = readFileSync(
      new URL("../../src/lib/auth/guard.ts", import.meta.url),
      "utf8",
    );
    assert.match(guard, /status: 401/);
    assert.match(guard, /Cache-Control": "no-store, no-transform/);
    assert.ok(!/redirect/.test(guard), "the guard must not redirect");
  });
});

describe("usage recording stays on the signed path", () => {
  it("still records from the provider-reported usage block only", () => {
    // The gate must not have changed where the numbers come from. They come from
    // the `done` frame, which `streamChatEvents` built from the provider response.
    assert.match(
      route,
      /if \(event\.type === "done" && event\.usage !== null && served !== null\) \{/,
    );
    assert.match(route, /void recordCompletedUsage\(served, event\.usage\);/);
    assert.match(route, /await recordUsage\(\{/);
  });

  it("never reads a token count from the request", () => {
    // A guard that introduced a `usage` field read from the body would undo the
    // entire server-authoritative fix.
    const handler = route.slice(route.indexOf("export async function POST"));
    assert.ok(
      !/formData|request\.json\(\)|body\.(usage|inputTokens|outputTokens)/.test(handler),
      "the handler must not read usage from the request",
    );
  });
});