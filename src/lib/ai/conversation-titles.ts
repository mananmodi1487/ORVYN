/**
 * Automatic conversation titles.
 *
 * A conversation starts with an empty title and the sidebar shows
 * "New conversation". Once the first user message is persisted, the
 * conversation is titled from that message — in the background,
 * through the same gateway and the same free-only routing rules as
 * every other generation: no paid provider, no new abstraction, and
 * never on the path of the answer the user is waiting for.
 *
 * Failure is a non-event: a conversation whose title could not be
 * generated keeps its empty title and works exactly as before, until
 * a later message on the same untitled conversation retries.
 */
import { createClient } from "@/utils/supabase/server";
import { isAiProviderError } from "./errors";
import type { AiGateway } from "./gateway";
import { getAiGateway } from "./runtime";
import type { ChatRequest } from "./types";

/**
 * How a model is asked to title a conversation.
 *
 * The prompt is the entire quality budget for a title. A vague ask —
 * "captures what the conversation is about" — lets a model file the
 * message under a generic bucket, answering "a gaming website for my
 * YouTube channel" with "Web Development". So the prompt names that
 * failure mode, demands the user's own topic words, bounds the
 * length, and forbids details the message never mentioned. The
 * title-only output contract keeps `toTitle` a cleaner rather than a
 * parser.
 */
const TITLE_SYSTEM_PROMPT =
  "Title the conversation from its first message. Keep the specific " +
  "topics, products, and subjects the user names: a request for a " +
  "gaming website for a YouTube channel is titled \"Gaming YouTube " +
  "Website\", never a generic label such as \"Web Development\", " +
  "\"Programming\", \"General Question\", or \"Help\". Two to six " +
  "words, using only terms the message contains — invent nothing. " +
  "Reply with the title only: no quotes, no greeting, no explanation.";

/** One title is a few words; the cap keeps a runaway model from writing an essay. */
const MAX_OUTPUT_TOKENS = 32;

/** Titles read as labels, so a lower temperature keeps them focused. */
const TITLE_TEMPERATURE = 0.2;

/** The longest title kept. The sidebar truncates longer labels anyway. */
const MAX_TITLE_LENGTH = 60;

/**
 * Conversations being titled right now. A retry that lands while a
 * generation for the same conversation is still running must not
 * start a second one.
 */
const inFlight = new Set<string>();

/**
 * The request that titles a conversation from its first message.
 *
 * It carries a system prompt, so `policyForRequest` raises
 * `requireSystemPrompt` and only models that declared support for
 * system messages can serve it. It does not ask for streaming, so
 * the non-streaming `generate` path — the cheaper one — serves it.
 */
export function titleRequest(firstMessage: string): ChatRequest {
  return {
    messages: [
      { role: "system", content: TITLE_SYSTEM_PROMPT },
      { role: "user", content: firstMessage },
    ],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: TITLE_TEMPERATURE,
  };
}

/**
 * Turns a model reply into a sidebar title, or `null` when the
 * reply holds no title.
 *
 * Wrapping quotes are stripped and whitespace collapses, because a
 * title is a label, not prose. A reply that is empty after cleaning
 * is no title at all rather than an empty string that would make the
 * conversation look untitled forever.
 */
export function toTitle(content: string): string | null {
  const title = content
    .replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title === "") return null;
  return title.length > MAX_TITLE_LENGTH
    ? title.slice(0, MAX_TITLE_LENGTH).trimEnd()
    : title;
}

/**
 * Generates a title for one first message through a gateway.
 *
 * The gateway applies the free-only default policy, so a paid or
 * unpriced model is never a candidate — with nothing free declared
 * this rejects `NO_ELIGIBLE_MODEL` instead of falling back to a
 * paid provider. Rejections propagate to the caller, which decides
 * what a failed title means.
 */
export async function generateTitle(
  firstMessage: string,
  gateway: AiGateway,
): Promise<string | null> {
  const result = await gateway.generate(titleRequest(firstMessage));
  return toTitle(result.content);
}

/**
 * Titles one conversation: reads its first user message, generates
 * a title through the gateway, and writes it back.
 *
 * Scheduled from the message-persistence route with `after`, so it
 * runs after that response has been sent and can never slow down
 * persisting a message or streaming an answer. Every failure is
 * caught and reduced to a diagnostic code: the conversation keeps
 * its empty title and stays fully usable.
 */
export async function titleConversation(input: {
  readonly conversationId: string;
  readonly userId: string;
}): Promise<void> {
  const { conversationId, userId } = input;
  if (inFlight.has(conversationId)) return;
  inFlight.add(conversationId);

  try {
    const client = await createClient();
    const firstMessage = await readFirstUserMessage(client, conversationId);
    if (firstMessage === null) return;

    const title = await generateTitle(firstMessage, getAiGateway());
    if (title === null) return;

    // The `title = ""` guard makes the write idempotent: whichever
    // generation lands first wins, and a conversation that already
    // has a title is never renamed by a late retry.
    const { error } = await client
      .from("conversations")
      .update({ title })
      .eq("id", conversationId)
      .eq("user_id", userId)
      .eq("title", "");

    if (error !== null) {
      logTitleFailure("database");
    }
  } catch (cause) {
    logTitleFailure(isAiProviderError(cause) ? cause.code : "generate");
  } finally {
    inFlight.delete(conversationId);
  }
}

/**
 * The conversation's first user message, which RLS already limits to
 * the signed-in user's own conversations. `null` when the
 * conversation has no user message to title from.
 */
async function readFirstUserMessage(
  client: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
): Promise<string | null> {
  const { data: messages, error } = await client
    .from("messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error !== null || messages === null || messages.length === 0) return null;
  const [first] = messages;
  return first === undefined ? null : first.content;
}

/**
 * One structured diagnostic line. It carries a stable category and
 * nothing else — no conversation id, user id, message content, or
 * provider prose — so an operator can grep for the gap without the
 * log becoming a record of what users asked.
 */
function logTitleFailure(code: string): void {
  console.error(
    JSON.stringify({
      event: "conversation_title_failed",
      code,
      at: new Date().toISOString(),
    }),
  );
}
