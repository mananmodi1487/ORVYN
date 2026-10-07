import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Rename and delete are mutating conversations, so the
 * properties that matter are pinned structurally, in the
 * same spirit as persistence.test.ts: the route handlers
 * depend on the request-scoped cookie store and a live
 * Supabase project, so a behavioural test against a stubbed
 * database could not prove *which status code* a failure
 * path answers with, nor that a write is scoped to the
 * signed-in user. The hook, shell and row are pinned the
 * same way — the property under test is *which request is
 * sent, which state updates, and which keystroke does
 * what*, not the network round trip.
 */

const detailRoute = readFileSync(
  new URL("../../src/app/api/conversations/[id]/route.ts", import.meta.url),
  "utf8",
);

const hook = readFileSync(
  new URL("../../src/lib/hooks/use-conversation.ts", import.meta.url),
  "utf8",
);

const shell = readFileSync(
  new URL("../../src/components/workspace/workspace-shell.tsx", import.meta.url),
  "utf8",
);

const row = readFileSync(
  new URL("../../src/components/workspace/conversation-row.tsx", import.meta.url),
  "utf8",
);

function handlerBetween(start: string, end?: string): string {
  const from = detailRoute.indexOf(start);
  assert.ok(from > -1, `${start} must exist in the detail route`);
  const to = end === undefined ? detailRoute.length : detailRoute.indexOf(end);
  assert.ok(to > from, `${end} must follow ${start}`);
  return detailRoute.slice(from, to);
}

describe("PATCH /api/conversations/[id] requires authentication", () => {
  const handler = handlerBetween(
    "export async function PATCH",
    "export async function DELETE",
  );

  it("checks the session before reading the title", () => {
    const gate = handler.indexOf("client.auth.getClaims()");
    const body = handler.indexOf("await request.json()");
    assert.ok(gate > -1, "the session must be checked");
    assert.ok(body > -1, "the title must be read from the body");
    assert.ok(
      gate < body,
      "the session check must precede the body read",
    );
    assert.match(handler, /status: 401/, "anonymous callers must be rejected");
  });

  it("identifies the caller from locally verified claims", () => {
    assert.match(handler, /getClaims\(\)/);
    assert.match(handler, /claimsData\?\.claims\?\.sub \?\? null/);
    assert.ok(
      !/auth\.getUser\(/.test(detailRoute),
      "no handler in the detail route may call GoTrue",
    );
  });
});

describe("PATCH /api/conversations/[id] validates the title", () => {
  const handler = handlerBetween(
    "export async function PATCH",
    "export async function DELETE",
  );

  it("rejects a missing, empty or overlong title with 400", () => {
    assert.match(handler, /typeof title !== "string"/, "a non-string title is invalid");
    assert.match(handler, /trimmed === ""/, "an empty title is invalid");
    assert.match(
      handler,
      /MAX_CONVERSATION_TITLE_LENGTH/,
      "an overlong title is invalid",
    );
    assert.match(handler, /status: 400/);
  });

  it("rejects a body that is not valid JSON", () => {
    assert.match(handler, /await request\.json\(\)/);
    assert.match(
      handler,
      /catch[\s\S]*status: 400/,
      "a malformed body must answer 400, not throw",
    );
  });

  it("trims the title before writing it", () => {
    assert.match(handler, /const trimmed = title\.trim\(\)/);
    assert.match(handler, /\.update\(\{ title: trimmed \}\)/);
  });
});

describe("PATCH /api/conversations/[id] enforces ownership", () => {
  const handler = handlerBetween(
    "export async function PATCH",
    "export async function DELETE",
  );

  it("scopes the write to the signed-in user", () => {
    // The RLS policy `conversations_update_own` enforces
    // the same scope at the database, so the row filter
    // and the policy agree on who may write.
    assert.match(handler, /\.eq\("user_id", userId\)/);
  });

  it("updates only the intended conversation", () => {
    assert.match(handler, /\.eq\("id", id\)/);
  });

  it("answers 404 for another user's conversation", () => {
    // A row that matches no id/user pair is a `.single()`
    // miss — PGRST116 — reported as not-found: the same
    // answer GET gives, so ownership is indistinguishable
    // from a missing id.
    assert.match(handler, /PGRST116/);
    assert.match(handler, /status: missing \? 404 : 500/);
  });
});

describe("DELETE /api/conversations/[id] stays ownership-scoped", () => {
  const handler = handlerBetween("export async function DELETE");

  it("requires the session", () => {
    assert.match(handler, /getClaims\(\)/);
    assert.match(handler, /status: 401/);
  });

  it("deletes only the signed-in user's conversation", () => {
    assert.match(handler, /\.eq\("user_id", userId\)/);
    assert.match(handler, /\.eq\("id", id\)/);
  });
});

describe("rename and delete flow through the hook", () => {
  it("renames with a PATCH carrying the title as JSON", () => {
    const rename = hook.slice(hook.indexOf("const renameConversation"));
    assert.match(rename, /method: "PATCH"/);
    assert.match(rename, /JSON\.stringify\(\{ title \}\)/);
  });

  it("evicts the deleted conversation from the cache", () => {
    const deletion = hook.slice(hook.indexOf("const deleteConversation"));
    assert.match(deletion, /method: "DELETE"/);
    assert.match(
      deletion,
      /conversationCache\.remove\(id\)/,
      "a deleted conversation must never render from the cache again",
    );
  });

  it("returns the empty state when the open conversation is deleted", () => {
    const deletion = hook.slice(hook.indexOf("const deleteConversation"));
    const guardAt = deletion.indexOf("conversationIdRef.current === id");
    const resetAt = deletion.indexOf("reset()", guardAt);
    assert.ok(guardAt > -1, "the open conversation must be detected");
    assert.ok(
      resetAt > guardAt,
      "the view must return to the empty state",
    );
  });

  it("reports failures as stable error codes", () => {
    assert.match(hook, /ConversationActionResult/);
    assert.match(
      hook,
      /ok: false,\s*error: await actionFailure/,
      "a failure must carry a code, not message text",
    );
  });
});

describe("the shell updates the sidebar without a reload", () => {
  it("updates the renamed conversation's title in place", () => {
    assert.match(
      shell,
      /items\.map\(\(item\) => \(item\.id === id \? \{ \.\.\.item, title \} : item\)\)/,
      "only the renamed conversation's title may change",
    );
  });

  it("removes the deleted conversation from the list", () => {
    assert.match(
      shell,
      /items\.filter\(\(item\) => item\.id !== id\)/,
      "only the deleted conversation may be removed",
    );
  });

  it("maps failure codes to readable messages", () => {
    assert.match(shell, /conversationActionErrorMessage\(result\.error\)/);
  });
});

describe("the conversation row's context menu", () => {
  it("saves a rename with Enter and cancels it with Escape", () => {
    assert.match(row, /key === "Enter"/);
    assert.match(row, /void saveRename\(\)/);
    assert.match(row, /key === "Escape"/);
    assert.match(row, /cancelRename\(\)/);
  });

  it("bounds the rename input to the server's title limit", () => {
    assert.match(row, /maxLength=\{MAX_CONVERSATION_TITLE_LENGTH\}/);
  });

  it("asks for confirmation before deleting", () => {
    // The menu's Delete item only enters the
    // confirmation step; the destructive call happens
    // from the confirm panel's Delete button alone.
    const deleteLabelAt = row.indexOf("conversationMenuCopy.delete");
    assert.ok(deleteLabelAt > -1, "the menu must offer delete");
    // The handler precedes the label it belongs to,
    // so the item is read backwards from its label.
    const onClickAt = row.lastIndexOf("onClick", deleteLabelAt);
    const deleteItem = row.slice(onClickAt, deleteLabelAt);
    assert.match(
      deleteItem,
      /setConfirmingDelete\(true\)/,
      "the menu item must enter confirmation, not delete",
    );
    assert.ok(
      !deleteItem.includes("onDelete()"),
      "the menu item must not delete directly",
    );
    assert.match(row, /await onDelete\(\)/, "the confirmation step performs the delete");
    assert.match(row, /void confirmDelete\(\)/, "the confirm button triggers it");
  });

  it("reports failures inline", () => {
    assert.match(row, /role="alert"/);
  });
});
