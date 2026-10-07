import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
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

  return NextResponse.json({ message: data });
}
