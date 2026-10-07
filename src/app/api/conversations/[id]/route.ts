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
 * DELETE /api/conversations/[id]
 * Deletes a conversation and its messages (cascade).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await createClient();

  const { data: auth } = await client.auth.getUser();
  if (auth.user === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;

  const { error } = await client
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error !== null) {
    return NextResponse.json({ error: "failed_to_delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
