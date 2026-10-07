import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ConversationRow = {
  id: string;
  title: string;
  updated_at: string;
  pinned_at: string | null;
};

type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt: string | null;
};

/**
 * Lists the signed-in user's conversations for the
 * sidebar: archived conversations are hidden, and
 * pinned ones lead the list.
 *
 * Failures are reported as error responses, never as an empty list:
 * the sidebar renders `[]` as "No conversations yet", so swallowing a
 * database error here would hide a broken schema behind a plausible
 * empty state.
 *
 * The caller is identified from the session JWT's claims, which the
 * server client verifies against the project's cached JWKS — no
 * GoTrue round trip is spent on identification.
 */
export async function GET() {
  const client = await createClient();

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (claimsError !== null || userId === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Archived conversations leave the list; pinned ones
  // lead it, newest pin first, and both groups fall
  // back to recency.
  const { data, error } = await client
    .from("conversations")
    .select("id, title, updated_at, pinned_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });

  if (error !== null) {
    return NextResponse.json({ error: "failed_to_list" }, { status: 500 });
  }

  const conversations: ConversationSummary[] = (
    (data ?? []) as ConversationRow[]
  ).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    pinnedAt: row.pinned_at,
  }));

  return NextResponse.json({ conversations });
}

/**
 * Creates a new empty conversation for the signed-in user.
 */
export async function POST() {
  const client = await createClient();

  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (claimsError !== null || userId === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data, error } = await client
    .from("conversations")
    .insert({ user_id: userId, title: "" })
    .select("id, title, created_at, updated_at")
    .single();

  if (error !== null || data === null) {
    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }

  return NextResponse.json({ conversation: data });
}
