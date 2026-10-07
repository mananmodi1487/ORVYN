import { titleConversation } from "@/lib/ai/conversation-titles";
import { createClient } from "@/utils/supabase/server";
import { after, NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/conversations/[id]/messages
 * Lists messages for a conversation, newest last.
 *
 * The caller is identified from the session JWT's claims, which the
 * server client verifies against the project's cached JWKS — no
 * GoTrue round trip is spent on identification.
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

  const { data: messages, error } = await client
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error !== null) {
    return NextResponse.json({ error: "failed_to_load" }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [] });
}

/**
 * POST /api/conversations/[id]/messages
 * Appends a message to the conversation.
 *
 * The first user message persisted for a conversation that
 * still has no title schedules a title for it. The title is
 * generated after this response has been sent — persisting a
 * message never waits on a generation, and a failed title
 * changes nothing about how the conversation works.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await createClient();

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (claimsError !== null || userId === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { role?: unknown; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { role, content } = body;
  if (role !== "user" && role !== "assistant") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof content !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await params;

  const { data, error } = await client
    .from("messages")
    .insert({ conversation_id: id, role, content })
    .select("id, role, content, created_at")
    .single();

  if (error !== null || data === null) {
    return NextResponse.json({ error: "failed_to_save" }, { status: 500 });
  }

  // A successful insert proves the caller owns the conversation
  // (the messages RLS policy requires it), so the title check
  // below is an ownership-scoped read, and only a conversation
  // that is still untitled is a title candidate.
  if (role === "user") {
    const { data: conversation, error: conversationError } = await client
      .from("conversations")
      .select("title")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (
      conversationError === null &&
      conversation !== null &&
      conversation.title === ""
    ) {
      after(async () => {
        await titleConversation({ conversationId: id, userId });
      });
    }
  }

  return NextResponse.json({ message: data });
}
