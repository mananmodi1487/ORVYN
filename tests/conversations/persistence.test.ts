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

const detailRoute = readFileSync(
  new URL("../../src/app/api/conversations/[id]/route.ts", import.meta.url),
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
    const gate = handler.indexOf("client.auth.getClaims()");
    const query = handler.indexOf('.from("conversations")');
    assert.ok(gate > -1, "the session must be checked");
    assert.ok(query > -1, "the list must be queried");
    assert.ok(gate < query, "the session check must precede the query");
  });

  it("identifies the caller from locally verified claims", () => {
    // getClaims verifies the session JWT's signature against the
    // project's JWKS, which is cached once per process. getUser would
    // spend a GoTrue round trip on every request to establish the
    // same identity.
    const handler = listRoute.slice(listRoute.indexOf("export async function GET"));
    assert.match(handler, /getClaims\(\)/);
    assert.match(handler, /claimsData\?\.claims\?\.sub \?\? null/);
    assert.ok(
      !handler.includes("getUser()"),
      "the list handler must not call GoTrue to identify the caller",
    );
  });

  it("returns the camelCase shape the sidebar expects", () => {
    // ConversationItem in components/workspace/app-sidebar.tsx is typed
    // with `updatedAt`; answering snake_case would silently leave every
    // field the type promises undefined.
    assert.match(listRoute, /updatedAt: row\.updated_at/);
  });
});

describe("GET /api/conversations filters and orders the sidebar list", () => {
  const handler = listRoute.slice(listRoute.indexOf("export async function GET"));

  it("hides archived conversations", () => {
    // Archiving removes a conversation from the
    // normal list: the query filters it out rather
    // than trusting the client to ignore it.
    assert.match(handler, /\.is\("archived_at", null\)/);
  });

  it("orders pinned conversations first, then by recency", () => {
    assert.match(
      handler,
      /\.order\("pinned_at", \{ ascending: false, nullsFirst: false \}\)/,
      "pinned conversations must lead, newest pin first",
    );
    assert.match(
      handler,
      /\.order\("updated_at", \{ ascending: false \}\)/,
      "both groups must fall back to recency",
    );
  });

  it("reports the pinned state the sidebar sorts by", () => {
    assert.match(handler, /pinnedAt: row\.pinned_at/);
    assert.match(handler, /select\("id, title, updated_at, pinned_at"\)/);
  });
});

describe("GET /api/conversations/[id]/messages reports failures honestly", () => {
  it("identifies the caller from locally verified claims, not the response wrapper", () => {
    // `getClaims()` verifies the session JWT's signature against the
    // cached JWKS. The old check tested the getUser() data wrapper,
    // which is never null — and it spent a GoTrue round trip per
    // request to do it.
    const handler = messagesRoute.slice(messagesRoute.indexOf("export async function GET"));
    assert.match(handler, /getClaims\(\)/);
    assert.match(handler, /claimsData\?\.claims\?\.sub \?\? null/);
    assert.ok(
      !/auth\.getUser\(/.test(handler),
      "the messages handler must not call GoTrue to identify the caller",
    );
  });

  it("answers 500 on database errors instead of an empty list", () => {
    const handler = messagesRoute.slice(messagesRoute.indexOf("export async function GET"));
    assert.ok(!/status: 200/.test(handler));
    assert.match(handler, /status: 500/);
  });
});

describe("GET /api/conversations/[id] opens a conversation in one round trip", () => {
  // The slice keeps the GET-specific assertions scoped to the open
  // path; the DELETE handler follows the same claims check, which
  // the whole-file assertion below pins.
  const handler = detailRoute.slice(
    detailRoute.indexOf("export async function GET"),
    detailRoute.indexOf("export async function DELETE"),
  );

  it("identifies the caller from locally verified claims", () => {
    // getClaims() verifies the session JWT's signature against the
    // project's JWKS, which is fetched once per process and cached.
    // getUser() would validate the session against GoTrue on every
    // conversation open.
    assert.match(handler, /getClaims\(\)/);
    assert.ok(
      !/auth\.getUser\(/.test(handler),
      "the open path must not call GoTrue",
    );
  });

  it("fetches the conversation and its messages in a single query", () => {
    assert.match(handler, /\.from\("conversations"\)/);
    assert.match(handler, /messages\(id, role, content, created_at\)/);
    assert.ok(
      !handler.includes('.from("messages")'),
      "a separate messages query would be a second round trip",
    );
  });

  it("scopes the row to the signed-in user", () => {
    assert.match(handler, /\.eq\("user_id", userId\)/);
  });

  it("answers 401, 404 and 500 distinctly", () => {
    assert.match(handler, /status: 401/);
    assert.match(handler, /status: missing \? 404 : 500/);
  });

  it("treats a .single() miss as not-found, not a failure", () => {
    assert.match(handler, /PGRST116/);
  });

  it("restores the chronological order PostgREST does not promise", () => {
    assert.match(handler, /localeCompare\(b\.created_at\)/);
  });

  it("never identifies a caller through GoTrue anywhere in the file", () => {
    // GET and DELETE both establish identity from verified
    // claims, so no handler in the detail route may call
    // getUser() at all.
    assert.ok(
      !/auth\.getUser\(/.test(detailRoute),
      "the detail route must not call GoTrue",
    );
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

describe("useConversation makes saving automatic and reliable", () => {
  it("notifies the caller the moment a conversation row exists", () => {
    // The sidebar must learn about a new conversation immediately,
    // not on the next page load.
    assert.match(hook, /onConversationCreated\?\.\(id\)/);
  });

  it("keeps the message on screen when the conversation cannot be created", () => {
    // The composer clears its draft as soon as Enter is pressed, so
    // the hook itself must keep the turn visible when creation fails.
    const send = hook.slice(hook.indexOf("const send = useCallback"));
    const commitAt = send.indexOf("commit([...turnsRef.current, orphan]");
    const errorAt = send.indexOf("Could not create conversation.");
    assert.ok(commitAt > -1, "the orphaned turn must be committed");
    assert.ok(errorAt > -1, "the failure must be reported");
    assert.ok(
      commitAt < errorAt,
      "the turn must be committed before the error is set",
    );
  });

  it("queues orphaned turns and flushes them once a conversation exists", () => {
    const send = hook.slice(hook.indexOf("const send = useCallback"));
    const flushAt = send.indexOf("for (const pendingText of pending)");
    assert.ok(flushAt > -1, "queued turns must be flushed after creation");
    assert.ok(
      flushAt < send.indexOf("void runRequest({"),
      "queued turns must be flushed before the stream starts",
    );
  });

  it("persists the assistant message even when the stream was interrupted", () => {
    // A reset or navigation mid-stream clears the controller, which
    // must not also discard the answer the user already saw.
    const finallyAt = hook.indexOf(".finally(() => {");
    const guardAt = hook.indexOf(
      "if (controllerRef.current === controller) {",
      finallyAt,
    );
    const persistAt = hook.indexOf(
      'persistMessage(currentConversationId, "assistant", answer)',
    );
    assert.ok(guardAt > -1, "the controller guard must exist");
    assert.ok(
      persistAt > guardAt,
      "assistant persistence must not depend on the controller guard",
    );
  });

  it("discards queued turns when the conversation is reset or replaced", () => {
    assert.match(hook, /pendingTurnsRef\.current = \[\];/);
  });
});
