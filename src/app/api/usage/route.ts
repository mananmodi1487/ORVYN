/**
 * `GET /api/usage` — the signed-in user's daily usage and the global pool.
 *
 * Separate from `/api/chat` because these figures change for reasons that have
 * nothing to do with a request in flight: another session, another device, or
 * simply time passing over the UTC day boundary. Polling them alongside a stream
 * would mean conflating "what this answer cost" with "what today has cost".
 *
 * Every field is nullable and `null` is a real answer, not an error. With no
 * Supabase project or no signed-in user there is nothing to attribute usage to,
 * and the client renders "unavailable" instead of a zero.
 */
import { readUsageSummary } from "@/lib/ai/usage-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, no-transform",
};

export async function GET(): Promise<Response> {
  const summary = await readUsageSummary();

  return Response.json(summary, { headers: NO_STORE_HEADERS });
}