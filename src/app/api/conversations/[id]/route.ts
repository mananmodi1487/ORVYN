import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/conversations/[id]
 * Returns the conversation and its messages, newest last.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await createClient();

  const { data: auth } = await client.auth.getUser();
  if (auth.user === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;

  const { data: conversation, error: convError } = await client
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .single();

  if (convError !== null || conversation === null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: messages, error: msgError } = await client
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (msgError !== null) {
    return NextResponse.json({ error: "failed_to_load" }, { status: 500 });
  }

  return NextResponse.json({
    conversation,
    messages: messages ?? [],
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
