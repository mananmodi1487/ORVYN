import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Conversation persistence is a data-loss bug class, so the properties
 * that matter are pinned structurally.
 *
 * These assertions read the source rather than importing it because the
 * route handlers depend on the request-scoped cookie store and a live
 * Supabase project, and because the property under test is *which status
 * code* a failure path answers with. A behavioural test against a stubbed
 * database would pass just as happily against a handler that answers 200
 * with an empty list on a database error — precisely the mistake that
 * made a missing schema look like "No conversations yet".
 */

const listRoute = readFileSync(
  new URL("../../src/app/api/conversations/route.ts", import.meta.url),
  "utf8",
);

const messagesRoute = readFileSync(
  new URL("../../src/app/api/conversations/[id]/messages/route.ts",
  import.meta.url),
  "utf8",
);

const hook = readFileSync(
  new URL("../../src/lib/hooks/use-conversation.ts", import.meta.url),
  "utf8",
);

describe("GET /api/conversations reports failures honestly", () => {
  it("answers 401 for anonymous requests and 500 on database errors", () => {
    const handler = listRoute.slice(listRoute.indexOf("export async function GET"));
    assert.ok(
      !/status: 200/.test(handler),
      "the list handler must not answer 200 — an empty list reads as 'No conversations yet'",
    );
    assert.match(handler, /status: 401/, "anonymous callers must be rejected");
    assert.match(handler, /status: 500/, "database failures must surface");
  });

  it("requires the session before querying", () => {
    const handler = listRoute.slice(listRoute.indexOf("export async function GET"));
    const gate = handler.indexOf("auth.user === null");
    const query = handler.indexOf('.from("conversations")');
    assert.ok(gate > -1, "the session must be checked");
    assert.ok(query > -1, "the list must be queried");
    assert.ok(gate < query, "the session check must precede the query");
  });

  it("returns the camelCase shape the sidebar expects", () => {
    // ConversationItem in components/workspace/app-sidebar.tsx is typed
    // with `updatedAt`; answering snake_case would silently leave every
    // field the type promises undefined.
    assert.match(listRoute, /updatedAt: row\.updated_at/);
  });
});

describe("GET /api/conversations/[id]/messages reports failures honestly", () => {
  it("checks the signed-in user, not the response wrapper", () => {
    // `user === null` tests the getUser() data wrapper, which is never
    // null — the check must look at the user itself or anonymous requests
    // fall straight through to the query.
    const handler = messagesRoute.slice(messagesRoute.indexOf("export async function GET"));
    assert.match(handler, /auth\.user === null/);
    assert.ok(!/\(user === null\)/.test(handler), "the wrapper check must be gone");
  });

  it("answers 500 on database errors instead of an empty list", () => {
    const handler = messagesRoute.slice(messagesRoute.indexOf("export async function GET"));
    assert.ok(!/status: 200/.test(handler));
    assert.match(handler, /status: 500/);
  });
});

describe("POST /api/conversations/[id]/messages validates its body", () => {
  it("rejects unknown roles and non-string content", () => {
    const handler = messagesRoute.slice(messagesRoute.indexOf("export async function POST"));
    assert.match(handler, /role !== "user" && role !== "assistant"/);
    assert.match(handler, /typeof content !== "string"/);
    assert.match(handler, /status: 400/);
  });

  it("rejects bodies that are not valid JSON", () => {
    assert.match(messagesRoute, /await request\.json\(\)/);
    const handler = messagesRoute.slice(messagesRoute.indexOf("export async function POST"));
    assert.ok(
      handler.includes("try {\n    body = await request.json();") ||
        /catch[\s\S]*status: 400/.test(handler),
      "a malformed body must answer 400, not throw",
    );
  });
});

describe("useConversation persists the whole turn", () => {
  it("persists the user message before the request is sent", () => {
    // Persisting the user turn up front means it survives a failed or
    // aborted stream, and it is always inserted before the assistant
    // reply, so replay order matches the conversation.
    const send = hook.slice(hook.indexOf("const send = useCallback"));
    const userAt = send.indexOf('persistMessage(currentConversationId, "user", text)');
    const requestAt = send.indexOf("void runRequest({");
    assert.ok(userAt > -1, "the user message must be persisted");
    assert.ok(requestAt > -1, "the request must be sent");
    assert.ok(
      userAt < requestAt,
      "the user message must be persisted before the stream starts",
    );
  });

  it("persists the assistant message when the stream settles", () => {
    assert.match(hook, /persistMessage\(currentConversationId, "assistant", answer\)/);
  });
});
