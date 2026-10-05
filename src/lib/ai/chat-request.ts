/**
 * Server-side validation for the `POST /api/chat` body.
 *
 * Every limit here is a hard cap, and anything that fails is rejected before the
 * gateway is consulted. The route therefore never has to defend the gateway from
 * a malformed body, and an oversized request costs a bounds check rather than an
 * upstream call.
 */
import { invalidRequest } from "./errors";
import type { ChatMessage, ChatRequest, ModelRef, RoutingStrategy } from "./types";

/** Longest single message accepted from the client. */
export const MAX_TURN_CHARS = 8_000;
/** Most messages accepted in one request. */
export const MAX_TURNS = 100;
/** Combined character budget across all turns in one request. */
export const MAX_TOTAL_CHARS = 100_000;
/** Longest client-generated turn id accepted. */
const MAX_TURN_ID_CHARS = 64;

const STRATEGIES: ReadonlySet<string> = new Set<RoutingStrategy>([
  "balanced",
  "lowest-latency",
  "lowest-cost",
  "highest-quality",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTurns(value: unknown): readonly ChatMessage[] {
  if (!Array.isArray(value)) throw invalidRequest("`turns` must be an array");
  if (value.length === 0) throw invalidRequest("`turns` must contain at least one message");
  if (value.length > MAX_TURNS) {
    throw invalidRequest(`\`turns\` must contain at most ${MAX_TURNS} messages`);
  }

  const messages: ChatMessage[] = [];
  let totalChars = 0;

  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) throw invalidRequest(`\`turns[${index}]\` must be an object`);

    const id = entry["id"];
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_TURN_ID_CHARS) {
      throw invalidRequest(`\`turns[${index}].id\` must be a non-empty short string`);
    }

    const role = entry["role"];
    if (role !== "user" && role !== "assistant") {
      throw invalidRequest(`\`turns[${index}].role\` must be "user" or "assistant"`);
    }

    const text = entry["text"];
    if (typeof text !== "string") throw invalidRequest(`\`turns[${index}].text\` must be a string`);
    if (text.trim() === "") throw invalidRequest(`\`turns[${index}].text\` must not be empty`);
    if (text.length > MAX_TURN_CHARS) {
      throw invalidRequest(`\`turns[${index}].text\` must be at most ${MAX_TURN_CHARS} characters`);
    }

    totalChars += text.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      throw invalidRequest(`conversation must be at most ${MAX_TOTAL_CHARS} characters`);
    }

    messages.push({ role, content: text });
  }

  // A conversation the gateway cannot act on is a client error, not an empty
  // generation. Both ends are enforced here so routing never sees a request it
  // would have to guess about.
  const first = messages[0];
  if (first === undefined || first.role !== "user") {
    throw invalidRequest("conversation must start with a `user` turn");
  }
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== "user") {
    throw invalidRequest("conversation must end with a `user` turn");
  }

  return messages;
}

function readPinnedModel(value: unknown): ModelRef | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw invalidRequest("`pinnedModel` must be an object");

  const provider = value["provider"];
  const modelId = value["modelId"];
  if (typeof provider !== "string" || provider.trim() === "") {
    throw invalidRequest("`pinnedModel.provider` must be a non-empty string");
  }
  if (typeof modelId !== "string" || modelId.trim() === "") {
    throw invalidRequest("`pinnedModel.modelId` must be a non-empty string");
  }
  return { provider, modelId };
}

/**
 * Converts an untrusted JSON body into a gateway `ChatRequest`.
 *
 * `requireStreaming` is set here rather than by the client: the route always
 * streams, so a non-streaming model must never be selected for it.
 *
 * @throws AiProviderError with code `INVALID_REQUEST`
 */
export function parseChatRequest(body: unknown): ChatRequest {
  if (!isRecord(body)) throw invalidRequest("request body must be a JSON object");

  const messages = readTurns(body["turns"]);

  const strategyValue = body["strategy"];
  if (strategyValue !== undefined && strategyValue !== null) {
    if (typeof strategyValue !== "string" || !STRATEGIES.has(strategyValue)) {
      throw invalidRequest("`strategy` is not a supported routing strategy");
    }
  }

  const pinnedModel = readPinnedModel(body["pinnedModel"]);

  return {
    messages,
    requireStreaming: true,
    ...(pinnedModel === undefined ? {} : { pinnedModel }),
    ...(typeof strategyValue === "string" ? { strategy: strategyValue as RoutingStrategy } : {}),
  };
}
