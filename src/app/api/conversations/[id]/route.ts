import {
  MAX_CONVERSATION_TITLE_LENGTH,
} from "@/config/workspace";
import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/conversations/[id]
 * Returns the conversation and its messages, newest last.
 *
 * The caller is identified from the session JWT's claims,
 * which the server client decodes locally — the signing key
 * is fetched once per process and cached — where getUser()
 * would validate the session against GoTrue on every
 * request. The conversation and its messages are fetched in
 * a single embedded-resource query, so opening a
 * conversation costs one PostgREST round trip instead of
 * three sequential ones.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await createClient();

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (claimsError !== null || userId === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;

  type MessageRow = {
    id: string;
    role: string;
    content: string;
    created_at: string;
  };

  const { data, error } = await client
    .from("conversations")
    .select(
      "id, title, created_at, updated_at, messages(id, role, content, created_at)",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error !== null || data === null) {
    // A `.single()` miss is reported as PGRST116; any other
    // failure is a server-side error, not a missing row.
    const missing = error === null || error.code === "PGRST116";
    return NextResponse.json(
      { error: missing ? "not_found" : "failed_to_load" },
      { status: missing ? 404 : 500 },
    );
  }

  const { messages, ...conversation } = data;

  // PostgREST does not promise an order for embedded
  // resources, so the chronological order the previous
  // separate messages query enforced is applied here.
  const orderedMessages = ((messages ?? []) as MessageRow[]).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  return NextResponse.json({
    conversation,
    messages: orderedMessages,
  });
}

/**
 * PATCH /api/conversations/[id]
 * Renames, pins, or archives a conversation.
 *
 * The request carries exactly one mutation: a `title`
 * rename, a `pinned` flag, or an `archived` flag — a body
 * with none or several of them is a client mistake and
 * answers 400. The title is the user's own text, so it is
 * trimmed and bounded before it touches the database: an
 * empty or oversized title answers 400 rather than storing
 * a blank sidebar entry. The write is scoped to the
 * signed-in user here and by the RLS policy, so another
 * user's conversation id matches no row and answers 404 —
 * the same not-found the GET path answers, which keeps
 * ownership from being distinguishable from a missing id.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await createClient();

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (claimsError !== null || userId === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { title?: unknown; pinned?: unknown; archived?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { title, pinned, archived } = body;

  // Exactly one mutation per request: a rename, a pin
  // change, or an archive change. A body that carries
  // none of them — or several at once — is invalid.
  const mutations = [title, pinned, archived].filter(
    (value) => value !== undefined,
  ).length;
  if (mutations !== 1) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await params;

  if (title !== undefined) {
    if (typeof title !== "string") {
      return NextResponse.json({ error: "invalid_title" }, { status: 400 });
    }

    const trimmed = title.trim();
    if (trimmed === "" || trimmed.length > MAX_CONVERSATION_TITLE_LENGTH) {
      return NextResponse.json({ error: "invalid_title" }, { status: 400 });
    }

    const { data, error } = await client
      .from("conversations")
      .update({ title: trimmed })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, title, updated_at")
      .single();

    if (error !== null || data === null) {
      // A `.single()` miss — another user's id included — is
      // PGRST116; anything else is a server-side failure.
      const missing = error === null || error.code === "PGRST116";
      return NextResponse.json(
        { error: missing ? "not_found" : "failed_to_update" },
        { status: missing ? 404 : 500 },
      );
    }

    return NextResponse.json({ conversation: data });
  }

  if (pinned !== undefined) {
    if (typeof pinned !== "boolean") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const { data, error } = await client
      .from("conversations")
      .update({ pinned_at: pinned ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, pinned_at, updated_at")
      .single();

    if (error !== null || data === null) {
      const missing = error === null || error.code === "PGRST116";
      return NextResponse.json(
        { error: missing ? "not_found" : "failed_to_pin" },
        { status: missing ? 404 : 500 },
      );
    }

    return NextResponse.json({ conversation: data });
  }

  if (archived !== undefined) {
    if (typeof archived !== "boolean") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const { data, error } = await client
      .from("conversations")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, archived_at, updated_at")
      .single();

    if (error !== null || data === null) {
      const missing = error === null || error.code === "PGRST116";
      return NextResponse.json(
        { error: missing ? "not_found" : "failed_to_archive" },
        { status: missing ? 404 : 500 },
      );
    }

    return NextResponse.json({ conversation: data });
  }

  // Unreachable: the mutation count above admits exactly
  // one of the three fields, and each branch returns.
  return NextResponse.json({ error: "invalid_request" }, { status: 400 });
}

/**
 * DELETE /api/conversations/[id]
 * Deletes a conversation and its messages (cascade).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await createClient();

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (claimsError !== null || userId === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;

  const { error } = await client
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error !== null) {
    return NextResponse.json({ error: "failed_to_delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
