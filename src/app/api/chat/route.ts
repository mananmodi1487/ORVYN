/**
 * `POST /api/chat` — the only path from the browser to a model.
 *
 * The browser sends validated conversation turns and receives a stream of
 * `ChatStreamEvent` frames. It never names a provider, never sees a credential,
 * and never decides which model answers: that is the gateway's job.
 *
 * Framing is newline-delimited JSON rather than Server-Sent Events. SSE is
 * specified for `GET` with `EventSource`, which cannot send a request body, and
 * this endpoint needs the full conversation.
 *
 * Failures are reported in one of two places, and which one applies is decided
 * by whether bytes have already been sent:
 * - Before the stream starts, a real HTTP status plus a JSON `error`. Body
 *   validation and model selection both land here.
 * - After it starts, the status is already committed, so the same `error` shape
 *   arrives as a terminal frame. Only a failure while generating does. Both come
 *   from `toChatStreamError`, so the client parses exactly one shape either way.
 */
import { parseChatRequest } from "@/lib/ai/chat-request";
import { ERROR_STATUS, type ChatStreamError, type ChatStreamEvent } from "@/lib/ai/chat-protocol";
import {
  selectChatModel,
  streamChatEvents,
  toChatStreamError,
} from "@/lib/ai/chat-service";
import { invalidRequest } from "@/lib/ai/errors";
import { getAiGateway } from "@/lib/ai/runtime";

/** Credentials and `fetch` semantics here are Node's, not the edge's. */
export const runtime = "nodejs";

/** A POST is never cached, but state it explicitly: responses are per-request. */
export const dynamic = "force-dynamic";

/**
 * Upper bound on the request body. The validated limits are far lower
 * (`MAX_TOTAL_CHARS`), so this only rejects an oversized upload before it is
 * buffered — it does not define what a valid conversation is.
 */
const MAX_BODY_BYTES = 512 * 1024;

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, no-transform",
  // Proxies that buffer would defeat the point of streaming the first token.
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request): Promise<Response> {
  let events: AsyncGenerator<ChatStreamEvent>;
  try {
    const chatRequest = parseChatRequest(await readJsonBody(request));
    const gateway = getAiGateway();
    // Selection happens here, not lazily inside the generator. By this point no
    // bytes have been sent, so "no model is configured" can still be reported as
    // a 503 instead of a 200 with the failure hidden in the body.
    const model = await selectChatModel(gateway, chatRequest);
    events = streamChatEvents(gateway, model, chatRequest, { signal: request.signal });
  } catch (cause) {
    return errorResponse(toChatStreamError(cause));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (cause) {
        // `streamChatEvents` reports failures as frames, so reaching here means
        // the framing itself failed. Emit the same shape rather than truncating
        // the body, which the client could not tell from a clean end.
        enqueue(controller, encoder, { type: "error", error: toChatStreamError(cause) });
      } finally {
        // A disconnected client makes every enqueue throw, so closing must not
        // throw either — that would mask the disconnect that caused it.
        try {
          controller.close();
        } catch {
          // Already closed or errored.
        }
        await events.return(undefined);
      }
    },
    cancel() {
      // Client hung up mid-stream: stop generating instead of paying for tokens
      // nobody will read.
      void events.return(undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { ...NO_STORE_HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

/**
 * Reads the body as JSON, rejecting anything malformed or oversized.
 *
 * `content-length` is only a hint — it is absent for chunked uploads — so the
 * buffered text is length-checked too. The limit is applied on both sides of the
 * read deliberately: before buffering where possible, and after unconditionally.
 *
 * Both failures use the AI layer's error contract, so a client never has to
 * distinguish "your JSON is broken" from "your provider is down" by shape.
 */
async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number.parseInt(declared, 10);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      throw invalidRequest(`request body must be at most ${MAX_BODY_BYTES} bytes`);
    }
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw invalidRequest(`request body must be at most ${MAX_BODY_BYTES} bytes`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidRequest("request body must be valid JSON");
  }
}

function enqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: ChatStreamEvent,
): void {
  try {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  } catch {
    // The client is already gone; there is nothing useful left to report.
  }
}

function errorResponse(error: ChatStreamError): Response {
  const status = ERROR_STATUS[error.code];
  return Response.json(
    { error },
    { status: status ?? 500, headers: NO_STORE_HEADERS },
  );
}
